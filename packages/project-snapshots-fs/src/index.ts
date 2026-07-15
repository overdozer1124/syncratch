/**
 * @experimental R1 atomic filesystem snapshot store.
 */

import { createHash, randomBytes } from "node:crypto";
import {
  closeSync,
  existsSync,
  fsyncSync,
  mkdirSync,
  openSync,
  readdirSync,
  renameSync,
  unlinkSync,
  writeFileSync,
  writeSync,
  readFileSync,
} from "node:fs";
import { join } from "node:path";
import type { SnapshotStore } from "@blocksync/project-service";

function sha256(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

export function createFsSnapshotStore(rootDir: string): SnapshotStore {
  mkdirSync(rootDir, { recursive: true });

  return {
    putAtomic(contentHash, bytes) {
      const storageKey = `${contentHash}.json`;
      const finalPath = join(rootDir, storageKey);

      if (existsSync(finalPath)) {
        const existing = new Uint8Array(readFileSync(finalPath));
        if (sha256(existing) !== contentHash) {
          throw new Error("SNAPSHOT_FINAL_HASH_MISMATCH");
        }
        return { storageKey };
      }

      const suffix = randomBytes(8).toString("hex");
      const tmpPath = join(rootDir, `${contentHash}.${suffix}.tmp`);
      const fd = openSync(tmpPath, "w");
      try {
        writeSync(fd, bytes);
        fsyncSync(fd);
      } finally {
        closeSync(fd);
      }

      if (existsSync(finalPath)) {
        const existing = new Uint8Array(readFileSync(finalPath));
        unlinkSync(tmpPath);
        if (sha256(existing) !== contentHash) {
          throw new Error("SNAPSHOT_FINAL_HASH_MISMATCH");
        }
        return { storageKey };
      }

      renameSync(tmpPath, finalPath);
      return { storageKey };
    },

    get(storageKey) {
      const path = join(rootDir, storageKey);
      if (!existsSync(path)) return null;
      return new Uint8Array(readFileSync(path));
    },

    gcOrphans(referencedStorageKeys) {
      const ref = new Set(referencedStorageKeys);
      let removed = 0;
      for (const name of readdirSync(rootDir)) {
        if (name.endsWith(".tmp")) {
          unlinkSync(join(rootDir, name));
          removed++;
          continue;
        }
        if (!name.endsWith(".json")) continue;
        if (!ref.has(name)) {
          unlinkSync(join(rootDir, name));
          removed++;
        }
      }
      return removed;
    },
  };
}

/** Test helper: write a file without going through putAtomic. */
export function writeRawSnapshotFile(
  rootDir: string,
  storageKey: string,
  bytes: Uint8Array,
): void {
  mkdirSync(rootDir, { recursive: true });
  writeFileSync(join(rootDir, storageKey), bytes);
}
