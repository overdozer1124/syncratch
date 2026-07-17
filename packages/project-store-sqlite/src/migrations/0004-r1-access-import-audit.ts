import type Database from "better-sqlite3";
import type {SchemaMigration} from "./types.js";

export const r1AccessImportAuditChecksumSource = [
  "version=4",
  "name=r1-access-import-audit",
  "createRoleAssignments",
  "createRosterImports",
  "createRosterImportRows",
  "createAuditEvents",
  "triggers:audit_events_no_update,audit_events_no_delete",
  "indexes:ux_ra_active_unique,idx_ra_account_status,idx_ra_ws_role,idx_ra_sys_role,idx_ri_workspace,idx_ri_school,idx_rir_import,idx_audit_ws_time,idx_audit_subject",
].join("\n");

export const r1AccessImportAuditMigration: SchemaMigration = {
  version: 4,
  name: "r1-access-import-audit",
  checksumSource: r1AccessImportAuditChecksumSource,
  checksum: "baeb69a344a16a58e8ca706afc4fde4951b21ab19252989bb96b829fe9349359",
  apply(db: Database.Database): void {
    db.exec(`
CREATE TABLE role_assignments (
  id TEXT PRIMARY KEY CHECK (length(trim(id)) > 0),
  account_id TEXT NOT NULL REFERENCES user_accounts(id),
  scope_kind TEXT NOT NULL
    CHECK (scope_kind IN ('system','workspace','school','class','project')),
  workspace_id TEXT REFERENCES workspaces(id),
  school_id TEXT REFERENCES schools(id),
  class_group_id TEXT REFERENCES class_groups(id),
  project_id TEXT REFERENCES projects(id),
  role TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('active','ended')),
  started_at TEXT NOT NULL,
  ended_at TEXT,
  CHECK (
    (scope_kind = 'system'
      AND workspace_id IS NULL AND school_id IS NULL
      AND class_group_id IS NULL AND project_id IS NULL)
    OR (scope_kind = 'workspace'
      AND workspace_id IS NOT NULL AND school_id IS NULL
      AND class_group_id IS NULL AND project_id IS NULL)
    OR (scope_kind = 'school'
      AND school_id IS NOT NULL AND workspace_id IS NULL
      AND class_group_id IS NULL AND project_id IS NULL)
    OR (scope_kind = 'class'
      AND class_group_id IS NOT NULL AND workspace_id IS NULL
      AND school_id IS NULL AND project_id IS NULL)
    OR (scope_kind = 'project'
      AND project_id IS NOT NULL AND workspace_id IS NULL
      AND school_id IS NULL AND class_group_id IS NULL)
  ),
  CHECK (
    (scope_kind = 'system' AND role IN ('owner','operator'))
    OR (scope_kind = 'workspace'
      AND role IN ('owner','admin','member','guest'))
    OR (scope_kind = 'school'
      AND role IN ('school_admin','staff','student'))
    OR (scope_kind = 'class'
      AND role IN ('teacher','assistant','student'))
    OR (scope_kind = 'project'
      AND role IN ('owner','host','editor','commenter','viewer'))
  ),
  CHECK (
    (status = 'active' AND ended_at IS NULL)
    OR (status = 'ended' AND ended_at IS NOT NULL)
  )
);

CREATE TABLE roster_imports (
  id TEXT PRIMARY KEY CHECK (length(trim(id)) > 0),
  workspace_id TEXT NOT NULL,
  school_id TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN (
    'uploaded','validated','preview_ready','applied','failed','discarded'
  )),
  uploaded_at TEXT NOT NULL,
  preview_hash TEXT CHECK (
    preview_hash IS NULL
    OR (
      length(preview_hash) = 64
      AND preview_hash = lower(preview_hash)
      AND preview_hash NOT GLOB '*[^0-9a-f]*'
    )
  ),
  base_directory_revision INTEGER CHECK (
    base_directory_revision IS NULL OR base_directory_revision >= 0
  ),
  applied_at TEXT,
  CHECK (
    (status = 'applied' AND applied_at IS NOT NULL)
    OR (status <> 'applied' AND applied_at IS NULL)
  ),
  FOREIGN KEY (school_id, workspace_id)
    REFERENCES schools(id, workspace_id)
);

CREATE TABLE roster_import_rows (
  id TEXT PRIMARY KEY CHECK (length(trim(id)) > 0),
  import_id TEXT NOT NULL REFERENCES roster_imports(id) ON DELETE CASCADE,
  row_number INTEGER NOT NULL CHECK (row_number >= 0),
  category TEXT NOT NULL CHECK (category IN (
    'add_person','update_display_fields','new_enrollment',
    'class_move','end_enrollment','duplicate_candidate',
    'attendance_collision','ambiguous_account_link','rejected_row'
  )),
  person_id TEXT REFERENCES people(id),
  proposed_json TEXT NOT NULL CHECK (
    json_valid(proposed_json) AND json_type(proposed_json) = 'object'
  ),
  issues_json TEXT NOT NULL CHECK (
    json_valid(issues_json) AND json_type(issues_json) = 'array'
  ),
  UNIQUE (import_id, row_number)
);

CREATE TABLE audit_events (
  id TEXT PRIMARY KEY CHECK (length(trim(id)) > 0),
  workspace_id TEXT REFERENCES workspaces(id),
  actor_account_id TEXT REFERENCES user_accounts(id),
  action TEXT NOT NULL CHECK (length(trim(action)) > 0),
  subject_type TEXT NOT NULL CHECK (length(trim(subject_type)) > 0),
  subject_id TEXT NOT NULL CHECK (length(trim(subject_id)) > 0),
  payload_json TEXT NOT NULL CHECK (
    json_valid(payload_json) AND json_type(payload_json) = 'object'
  ),
  created_at TEXT NOT NULL,
  directory_revision INTEGER NOT NULL CHECK (directory_revision >= 0)
);

CREATE TRIGGER audit_events_no_update
BEFORE UPDATE ON audit_events
BEGIN
  SELECT RAISE(ABORT, 'audit_events are append-only');
END;

CREATE TRIGGER audit_events_no_delete
BEFORE DELETE ON audit_events
BEGIN
  SELECT RAISE(ABORT, 'audit_events are append-only');
END;

CREATE UNIQUE INDEX ux_ra_active_unique
  ON role_assignments(
    account_id,
    scope_kind,
    COALESCE(workspace_id, ''),
    COALESCE(school_id, ''),
    COALESCE(class_group_id, ''),
    COALESCE(project_id, ''),
    role
  )
  WHERE status = 'active';

CREATE INDEX IF NOT EXISTS idx_ra_account_status
  ON role_assignments(account_id, status);
CREATE INDEX IF NOT EXISTS idx_ra_ws_role
  ON role_assignments(workspace_id, role) WHERE status = 'active';
CREATE INDEX IF NOT EXISTS idx_ra_sys_role
  ON role_assignments(scope_kind, role) WHERE status = 'active';

CREATE INDEX IF NOT EXISTS idx_ri_workspace ON roster_imports(workspace_id);
CREATE INDEX IF NOT EXISTS idx_ri_school ON roster_imports(school_id);
CREATE INDEX IF NOT EXISTS idx_rir_import ON roster_import_rows(import_id);
CREATE INDEX IF NOT EXISTS idx_audit_ws_time
  ON audit_events(workspace_id, created_at);
CREATE INDEX IF NOT EXISTS idx_audit_subject
  ON audit_events(subject_type, subject_id);
`);
  },
};
