import type Database from "better-sqlite3";
import type {SchemaMigration} from "./types.js";

export const r1IdentityCoreChecksumSource = [
  "version=2",
  "name=r1-identity-core",
  "createWorkspaces",
  "createUserAccounts",
  "createPeople",
  "createPersonAccountLinks",
  "createWorkspaceMemberships",
  "createWorkspaceDirectoryRevisions",
  "indexes:ux_pal_active_account,ux_pal_active_person,ux_wm_active,idx_pal_person,idx_pal_account,idx_wm_account,idx_wm_workspace",
].join("\n");

export const r1IdentityCoreMigration: SchemaMigration = {
  version: 2,
  name: "r1-identity-core",
  checksumSource: r1IdentityCoreChecksumSource,
  checksum: "517ebe94643f376cbab6a891030d2b3244a1a6b2f4764561890b1f768ed60848",
  apply(db: Database.Database): void {
    db.exec(`
CREATE TABLE workspaces (
  id TEXT PRIMARY KEY CHECK (length(trim(id)) > 0),
  kind TEXT NOT NULL CHECK (kind IN ('personal','casual','school')),
  name TEXT NOT NULL CHECK (length(trim(name)) > 0),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE user_accounts (
  id TEXT PRIMARY KEY CHECK (length(trim(id)) > 0),
  display_name TEXT,
  email TEXT,
  status TEXT NOT NULL CHECK (status IN ('active','disabled')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE people (
  id TEXT PRIMARY KEY CHECK (length(trim(id)) > 0),
  display_name TEXT NOT NULL CHECK (length(trim(display_name)) > 0),
  status TEXT NOT NULL CHECK (status IN ('active','disabled','archived')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE person_account_links (
  id TEXT PRIMARY KEY CHECK (length(trim(id)) > 0),
  person_id TEXT NOT NULL REFERENCES people(id),
  account_id TEXT NOT NULL REFERENCES user_accounts(id),
  status TEXT NOT NULL CHECK (status IN ('active','unlinked')),
  linked_at TEXT NOT NULL,
  unlinked_at TEXT,
  CHECK (
    (status = 'active' AND unlinked_at IS NULL)
    OR (status = 'unlinked' AND unlinked_at IS NOT NULL)
  )
);

CREATE TABLE workspace_memberships (
  id TEXT PRIMARY KEY CHECK (length(trim(id)) > 0),
  workspace_id TEXT NOT NULL REFERENCES workspaces(id),
  account_id TEXT NOT NULL REFERENCES user_accounts(id),
  role TEXT NOT NULL CHECK (role IN ('owner','admin','member','guest')),
  status TEXT NOT NULL CHECK (status IN ('active','ended')),
  started_at TEXT NOT NULL,
  ended_at TEXT,
  CHECK (
    (status = 'active' AND ended_at IS NULL)
    OR (status = 'ended' AND ended_at IS NOT NULL)
  )
);

CREATE TABLE workspace_directory_revisions (
  workspace_id TEXT PRIMARY KEY REFERENCES workspaces(id),
  revision INTEGER NOT NULL DEFAULT 0 CHECK (revision >= 0),
  updated_at TEXT NOT NULL
);

CREATE UNIQUE INDEX ux_pal_active_account
  ON person_account_links(account_id) WHERE status = 'active';

CREATE UNIQUE INDEX ux_pal_active_person
  ON person_account_links(person_id) WHERE status = 'active';

CREATE UNIQUE INDEX ux_wm_active
  ON workspace_memberships(workspace_id, account_id) WHERE status = 'active';

CREATE INDEX IF NOT EXISTS idx_pal_person ON person_account_links(person_id);
CREATE INDEX IF NOT EXISTS idx_pal_account ON person_account_links(account_id);
CREATE INDEX IF NOT EXISTS idx_wm_account ON workspace_memberships(account_id);
CREATE INDEX IF NOT EXISTS idx_wm_workspace ON workspace_memberships(workspace_id);
`);
  },
};
