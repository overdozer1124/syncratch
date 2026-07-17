/**
 * Wire project-autosave to Persist PUT /document for the narrow host.
 */

import {
  createAutosaveController,
  type AutosaveController,
} from "@blocksync/project-autosave";
import type { ProjectDocument } from "@blocksync/project-schema";
import type { AdapterHandle } from "@blocksync/scratch-adapter";
import type { PersistClient } from "./persist-client.js";
import { vmToDocument } from "./document-bridge.js";

export interface HostAutosave {
  controller: AutosaveController;
  notifyEdit(handle: AdapterHandle): void;
  getRevision(): number;
}

export function createHostAutosave(args: {
  client: PersistClient;
  projectId: string;
  initialRevision: number;
  md5extToSha: Map<string, string>;
  metaOverride: ProjectDocument["meta"];
  debounceMs?: number;
}): HostAutosave {
  let revision = args.initialRevision;
  const controller = createAutosaveController({
    debounceMs: args.debounceMs ?? 50,
    retryDelaysMs: [],
    idFactory: () => crypto.randomUUID(),
    getBaseRevision: () => revision,
    setBaseRevision: (next) => {
      revision = next;
    },
    save: async ({ baseRevision, transactionId, schemaVersion, document }) => {
      const envelope = await args.client.putDocument(args.projectId, {
        baseRevision,
        transactionId,
        schemaVersion,
        document,
      });
      return { revision: envelope.revision };
    },
  });

  return {
    controller,
    notifyEdit(handle) {
      const document: ProjectDocument = vmToDocument(
        handle,
        args.md5extToSha,
        args.metaOverride,
      );
      controller.notifyLocalEdit(document);
    },
    getRevision: () => revision,
  };
}
