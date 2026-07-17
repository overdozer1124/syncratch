/**
 * Narrow Scratch host session: open project from Persist + §7.3 assets + autosave.
 */

import type { ProjectDocument } from "@blocksync/project-schema";
import type { AdapterHandle } from "@blocksync/scratch-adapter";
import type { AutosaveController } from "@blocksync/project-autosave";
import type { PersistClient } from "./persist-client.js";
import {
  buildAssetMaps,
  loadDocumentIntoVm,
} from "./document-bridge.js";
import { attachPersistStorage } from "./persist-storage.js";
import { createHostAutosave } from "./autosave-host.js";

export type { PersistClient, ProjectEnvelope } from "./persist-client.js";
export { createPersistClient } from "./persist-client.js";

export interface ProjectSession {
  projectId: string;
  document: ProjectDocument;
  revision: number;
  autosave: AutosaveController;
  notifyEdit(handle: AdapterHandle): void;
  flush(): Promise<void>;
  dispose(): void;
}

export async function openProjectSession(args: {
  client: PersistClient;
  projectId: string;
  handle: AdapterHandle;
}): Promise<ProjectSession> {
  const envelope = await args.client.getProject(args.projectId);
  const { assetIndex, md5extToSha } = buildAssetMaps(envelope.document);

  attachPersistStorage(args.handle, {
    client: args.client,
    projectId: args.projectId,
    assetIndex,
  });
  await loadDocumentIntoVm(args.handle, envelope.document);

  const hostAutosave = createHostAutosave({
    client: args.client,
    projectId: args.projectId,
    initialRevision: envelope.revision,
    md5extToSha,
    metaOverride: envelope.document.meta,
  });

  return {
    projectId: args.projectId,
    document: envelope.document,
    revision: envelope.revision,
    autosave: hostAutosave.controller,
    notifyEdit: (handle) => hostAutosave.notifyEdit(handle),
    async flush() {
      await hostAutosave.controller.flush();
    },
    dispose() {
      hostAutosave.controller.dispose();
    },
  };
}
