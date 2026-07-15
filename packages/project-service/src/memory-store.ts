import type { ProjectEnvelopeV1 } from "@blocksync/project-envelope";
import { StaleRevisionError } from "./errors.js";
import type {
  ProjectRepository,
  ProjectRepositoryTx,
  ProjectSummary,
  SnapshotMeta,
  SnapshotStore,
} from "./ports.js";

interface ProjectRow {
  organizationId: string;
  ownerUserId: string;
  title: string;
  headRevision: number;
  head: ProjectEnvelopeV1;
}

interface RevisionRow {
  envelope: ProjectEnvelopeV1;
  contentHash: string;
  requestHash: string;
  transactionId: string;
}

export function createMemoryProjectRepository(): ProjectRepository & {
  /** Test helper: force fail after mutator for rollback tests when wrapped. */
  failNextTransaction?: boolean;
} {
  const projects = new Map<string, ProjectRow>();
  const members = new Map<string, Map<string, "owner" | "member" | "admin">>();
  const revisions = new Map<string, Map<number, RevisionRow>>();
  const byTx = new Map<string, Map<string, RevisionRow>>();
  const snapshots = new Map<string, SnapshotMeta>();

  const repo: ProjectRepository & { failNextTransaction?: boolean } = {
    withTransaction<T>(fn: (tx: ProjectRepositoryTx) => T): T {
      // Snapshot-and-restore for rollback simulation.
      const snapProjects = structuredClone([...projects.entries()]);
      const snapMembers = structuredClone(
        [...members.entries()].map(([k, v]) => [k, [...v.entries()]] as const),
      );
      const snapRevisions = structuredClone(
        [...revisions.entries()].map(([k, v]) => [k, [...v.entries()]] as const),
      );
      const snapByTx = structuredClone(
        [...byTx.entries()].map(([k, v]) => [k, [...v.entries()]] as const),
      );
      const snapSnapshots = structuredClone([...snapshots.entries()]);

      const tx: ProjectRepositoryTx = {
        createProject(args) {
          if (projects.has(args.projectId)) {
            throw new Error("PROJECT_EXISTS");
          }
          projects.set(args.projectId, {
            organizationId: args.organizationId,
            ownerUserId: args.ownerUserId,
            title: args.title,
            headRevision: args.envelope.revision,
            head: args.envelope,
          });
          members.set(
            args.projectId,
            new Map([[args.ownerUserId, "owner"]]),
          );
          const revMap = new Map<number, RevisionRow>();
          revMap.set(args.envelope.revision, {
            envelope: args.envelope,
            contentHash: args.envelope.contentHash,
            requestHash: "",
            transactionId: "",
          });
          revisions.set(args.projectId, revMap);
          byTx.set(args.projectId, new Map());
          return args.envelope;
        },

        listProjectSummariesForMember(userId, organizationId): ProjectSummary[] {
          const out: ProjectSummary[] = [];
          for (const [projectId, row] of projects) {
            if (row.organizationId !== organizationId) continue;
            const m = members.get(projectId)?.get(userId);
            if (!m) continue;
            out.push({
              projectId,
              title: row.title,
              revision: row.headRevision,
            });
          }
          return out.sort((a, b) => a.projectId.localeCompare(b.projectId));
        },

        getMembership(projectId, userId) {
          const row = projects.get(projectId);
          if (!row) return null;
          const role = members.get(projectId)?.get(userId);
          if (!role) return null;
          return { role, organizationId: row.organizationId };
        },

        getHead(projectId) {
          return projects.get(projectId)?.head ?? null;
        },

        findRevisionByTransactionId(projectId, transactionId) {
          const row = byTx.get(projectId)?.get(transactionId);
          if (!row) return null;
          return { envelope: row.envelope, requestHash: row.requestHash };
        },

        commitRevision(args) {
          const row = projects.get(args.projectId);
          if (!row) throw new Error("MISSING_PROJECT");
          if (row.headRevision !== args.baseRevision) {
            throw new StaleRevisionError();
          }
          if (args.envelope.revision !== args.baseRevision + 1) {
            throw new Error("BAD_ENVELOPE_REVISION");
          }
          row.headRevision = args.envelope.revision;
          row.head = args.envelope;
          row.title = args.envelope.title;
          const revRow: RevisionRow = {
            envelope: args.envelope,
            contentHash: args.contentHash,
            requestHash: args.requestHash,
            transactionId: args.transactionId,
          };
          revisions.get(args.projectId)!.set(args.envelope.revision, revRow);
          byTx.get(args.projectId)!.set(args.transactionId, revRow);
          return args.envelope;
        },

        insertSnapshotMeta(meta) {
          const key = `${meta.projectId}\0${meta.snapshotId}`;
          if (snapshots.has(key)) throw new Error("SNAPSHOT_EXISTS");
          snapshots.set(key, meta);
        },

        getSnapshotMeta(projectId, snapshotId) {
          return snapshots.get(`${projectId}\0${snapshotId}`) ?? null;
        },

        listSnapshotMeta(projectId) {
          return [...snapshots.values()]
            .filter((s) => s.projectId === projectId)
            .sort((a, b) => a.snapshotId.localeCompare(b.snapshotId));
        },
      };

      try {
        const result = fn(tx);
        if (repo.failNextTransaction) {
          repo.failNextTransaction = false;
          throw new Error("FORCED_ROLLBACK");
        }
        return result;
      } catch (err) {
        projects.clear();
        for (const [k, v] of snapProjects) projects.set(k, v);
        members.clear();
        for (const [k, entries] of snapMembers) {
          members.set(k, new Map(entries));
        }
        revisions.clear();
        for (const [k, entries] of snapRevisions) {
          revisions.set(k, new Map(entries));
        }
        byTx.clear();
        for (const [k, entries] of snapByTx) {
          byTx.set(k, new Map(entries));
        }
        snapshots.clear();
        for (const [k, v] of snapSnapshots) snapshots.set(k, v);
        throw err;
      }
    },
  };

  return repo;
}

export function createMemorySnapshotStore(): SnapshotStore & {
  files: Map<string, Uint8Array>;
} {
  const files = new Map<string, Uint8Array>();
  return {
    files,
    putAtomic(contentHash, bytes) {
      const storageKey = `${contentHash}.json`;
      const existing = files.get(storageKey);
      if (existing) {
        return { storageKey };
      }
      files.set(storageKey, bytes);
      return { storageKey };
    },
    get(storageKey) {
      return files.get(storageKey) ?? null;
    },
    gcOrphans(referencedStorageKeys) {
      const ref = new Set(referencedStorageKeys);
      let removed = 0;
      for (const key of [...files.keys()]) {
        if (!ref.has(key)) {
          files.delete(key);
          removed++;
        }
      }
      return removed;
    },
  };
}
