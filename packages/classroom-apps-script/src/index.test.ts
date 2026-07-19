import {describe, expect, it, vi} from "vitest";
import {
  ClassroomAdapterError,
  createClassroomAppsScriptClient,
  validateClassroomRequest,
} from "./index.js";

describe("classroom Apps Script contract", () => {
  it("rejects project payloads and Yjs updates at any depth", () => {
    expect(() => validateClassroomRequest({
      action: "upsertRoom",
      room: {
        roomId: "room-1",
        driveFileId: "drive-1",
        projectDocument: {targets: []},
      },
    })).toThrowError(ClassroomAdapterError);
    expect(() => validateClassroomRequest({
      action: "createInvitation",
      metadata: {nested: {yjsUpdate: "forbidden"}},
    })).toThrowError(/must not contain project payloads/i);
  });

  it("rejects requests larger than the classroom metadata limit", () => {
    expect(() => validateClassroomRequest({
      action: "upsertRoom",
      room: {roomId: "room-1", note: "x".repeat(33 * 1024)},
    })).toThrowError(/32 KiB/);
  });

  it("lists roster metadata without sending project content", async () => {
    const fetch = vi.fn(async (
      _url: RequestInfo | URL,
      init?: RequestInit,
    ) => {
      expect(JSON.parse(String(init?.body))).toEqual({
        action: "listRoster",
        classId: "class-1",
        identityToken: "verified-id-token",
      });
      expect(init?.credentials).toBe("omit");
      return new Response(JSON.stringify({
        ok: true,
        data: {
          members: [{
            email: "student@example.edu",
            displayName: "Student",
            role: "student",
          }],
        },
      }), {status: 200});
    });
    const client = createClassroomAppsScriptClient({
      endpoint: "https://script.google.com/macros/s/deployment/exec",
      fetch,
      getIdentityToken: async () => "verified-id-token",
    });

    await expect(client.listRoster("class-1")).resolves.toEqual([{
      email: "student@example.edu",
      displayName: "Student",
      role: "student",
    }]);
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("reports an unavailable optional adapter without leaking response bodies", async () => {
    const client = createClassroomAppsScriptClient({
      endpoint: "https://script.google.com/macros/s/deployment/exec",
      fetch: async () => new Response("private deployment details", {status: 503}),
      getIdentityToken: async () => "verified-id-token",
    });

    await expect(client.getRoom("room-1")).rejects.toMatchObject({
      code: "UNAVAILABLE",
      message: "Classroom adapter is unavailable",
    });
  });

  it("preserves a server-side unavailable result for degraded-mode handling", async () => {
    const client = createClassroomAppsScriptClient({
      endpoint: "https://script.google.com/macros/s/deployment/exec",
      fetch: async () => new Response(JSON.stringify({
        ok: false,
        error: {code: "UNAVAILABLE", message: "internal lock detail"},
      })),
      getIdentityToken: async () => "verified-id-token",
    });

    await expect(client.getRoom("room-1")).rejects.toMatchObject({
      code: "UNAVAILABLE",
      message: "Classroom adapter is unavailable",
    });
  });

  it("fails closed when a Google identity token is unavailable", async () => {
    const fetch = vi.fn();
    const client = createClassroomAppsScriptClient({
      endpoint: "https://script.google.com/macros/s/deployment/exec",
      fetch,
      getIdentityToken: async () => {
        throw new Error("popup closed");
      },
    });

    await expect(client.getRoom("room-1")).rejects.toMatchObject({
      code: "UNAVAILABLE",
      message: "Classroom adapter authentication is unavailable",
    });
    expect(fetch).not.toHaveBeenCalled();
  });

  it("rejects malformed success payloads", async () => {
    const client = createClassroomAppsScriptClient({
      endpoint: "https://script.google.com/macros/s/deployment/exec",
      fetch: async () => new Response(JSON.stringify({ok: true, data: {}})),
      getIdentityToken: async () => "verified-id-token",
    });

    await expect(client.listRoster("class-1")).rejects.toMatchObject({
      code: "INVALID_RESPONSE",
    });
  });

  it("times out a stalled optional adapter", async () => {
    const client = createClassroomAppsScriptClient({
      endpoint: "https://script.google.com/macros/s/deployment/exec",
      fetch: async (_input, init) => new Promise((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () =>
          reject(new DOMException("Aborted", "AbortError")));
      }),
      getIdentityToken: async () => "verified-id-token",
      timeoutMs: 5,
    });

    await expect(client.getRoom("room-1")).rejects.toMatchObject({
      code: "UNAVAILABLE",
    });
  });
});
