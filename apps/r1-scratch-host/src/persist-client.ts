/**
 * Thin Persist HTTP client for the narrow Scratch host (Task 10).
 */

import type { ProjectDocument } from "@blocksync/project-schema";

export type PersistFetch = (
  path: string,
  init?: RequestInit,
) => Response | Promise<Response>;

export interface ProjectEnvelope {
  projectId: string;
  organizationId: string;
  schemaVersion: number;
  revision: number;
  contentHash: string;
  document: ProjectDocument;
}

export interface PersistClient {
  getProject(projectId: string): Promise<ProjectEnvelope>;
  putDocument(
    projectId: string,
    body: {
      baseRevision: number;
      transactionId: string;
      schemaVersion: number;
      document: ProjectDocument;
    },
  ): Promise<ProjectEnvelope>;
  getAssetBytes(projectId: string, sha256: string): Promise<Uint8Array>;
  exportSb3(projectId: string): Promise<Uint8Array>;
  importSb3(title: string, bytes: Uint8Array): Promise<ProjectEnvelope>;
}

export function createPersistClient(options: {
  fetch: PersistFetch;
  baseHeaders?: HeadersInit;
}): PersistClient {
  const baseHeaders = new Headers(options.baseHeaders ?? {});

  const request = async (path: string, init?: RequestInit): Promise<Response> => {
    const headers = new Headers(baseHeaders);
    if (init?.headers) {
      new Headers(init.headers).forEach((value, key) => headers.set(key, value));
    }
    const res = await Promise.resolve(options.fetch(path, { ...init, headers }));
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(`persist ${init?.method ?? "GET"} ${path} → ${res.status}: ${text}`);
    }
    return res;
  };

  return {
    async getProject(projectId) {
      const res = await request(`/v1/projects/${encodeURIComponent(projectId)}`);
      return (await res.json()) as ProjectEnvelope;
    },

    async putDocument(projectId, body) {
      const res = await request(
        `/v1/projects/${encodeURIComponent(projectId)}/document`,
        {
          method: "PUT",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(body),
        },
      );
      return (await res.json()) as ProjectEnvelope;
    },

    async getAssetBytes(projectId, sha256) {
      const res = await request(
        `/v1/projects/${encodeURIComponent(projectId)}/assets/${encodeURIComponent(sha256)}`,
      );
      return new Uint8Array(await res.arrayBuffer());
    },

    async exportSb3(projectId) {
      const res = await request(
        `/v1/projects/${encodeURIComponent(projectId)}/export.sb3`,
      );
      return new Uint8Array(await res.arrayBuffer());
    },

    async importSb3(title, bytes) {
      const boundary = `----blocksync${Date.now().toString(16)}`;
      const prefix = `--${boundary}\r\nContent-Disposition: form-data; name="title"\r\n\r\n${title}\r\n--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="project.sb3"\r\nContent-Type: application/zip\r\n\r\n`;
      const suffix = `\r\n--${boundary}--\r\n`;
      const head = new TextEncoder().encode(prefix);
      const tail = new TextEncoder().encode(suffix);
      const body = new Uint8Array(head.length + bytes.length + tail.length);
      body.set(head, 0);
      body.set(bytes, head.length);
      body.set(tail, head.length + bytes.length);
      const res = await request(`/v1/projects/import`, {
        method: "POST",
        headers: {
          "content-type": `multipart/form-data; boundary=${boundary}`,
        },
        body,
      });
      return (await res.json()) as ProjectEnvelope;
    },
  };
}
