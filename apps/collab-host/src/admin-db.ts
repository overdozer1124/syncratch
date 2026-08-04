/**
 * Host-local SQLite for classroom admin accounts, policies, and student links.
 * Never stores project payloads, Yjs updates, or Drive tokens.
 */
import {mkdirSync} from "node:fs";
import {dirname} from "node:path";
import Database from "better-sqlite3";
import {
  createOpaqueId,
  createStudentLinkToken,
  mergeClassroomPolicy,
  normalizeClassroomPolicyInput,
  normalizeEmail,
  toStudentPolicyView,
  type AdminAccount,
  type ClassroomPolicy,
  type ClassroomPolicyInput,
  type StudentLink,
  type StudentLinkListItem,
  type StudentPolicyView,
} from "@blocksync/classroom-access";
import {createGrantId, STUDENT_GRANT_TTL_MS} from "./student-grant.js";
import {
  ADMIN_DB_MIGRATIONS,
  runAdminDbMigrations,
} from "./admin-db-migrations/index.js";

export interface AdminDbPolicyOptions {
  classroomRosterEnabled?: boolean;
  teacherDriveSubmissionEnabled?: boolean;
}

export type PolicyWriteResult =
  | {ok: true; policy: ClassroomPolicy}
  | {ok: false; kind: "not_found"}
  | {ok: false; kind: "bad_request"; code: string; message: string};

export interface AdminDb {
  /** Infrastructure wiring only — do not write business queries against this. */
  readonly sqlite: Database.Database;
  upsertAdminFromLogin(input: {
    subject: string;
    email: string;
    displayName: string | null;
  }): AdminAccount;
  getAdminById(adminId: string): AdminAccount | null;
  listPolicies(ownerAdminId: string): ClassroomPolicy[];
  getPolicy(policyId: string, ownerAdminId?: string): ClassroomPolicy | null;
  createPolicy(
    ownerAdminId: string,
    input: ClassroomPolicyInput,
    options?: AdminDbPolicyOptions,
  ): PolicyWriteResult;
  updatePolicy(
    policyId: string,
    ownerAdminId: string,
    patch: ClassroomPolicyInput,
    options?: AdminDbPolicyOptions,
  ): PolicyWriteResult;
  listLinks(ownerAdminId: string, policyId?: string): StudentLinkListItem[];
  createLink(input: {
    ownerAdminId: string;
    policyId: string;
    label: string;
    expiresAt?: string | null;
  }): StudentLink | null;
  revokeLink(linkId: string, ownerAdminId: string): StudentLinkListItem | null;
  reissueLink(
    linkId: string,
    ownerAdminId: string,
    expiresAt?: string | null,
  ): StudentLink | null;
  createStudentGrant(
    token: string,
    grantTtlMs?: number,
    nowIso?: string,
  ): {grantId: string; expiresAt: string} | null;
  resolveStudentPolicyByGrant(
    grantId: string,
    nowIso?: string,
    options?: AdminDbPolicyOptions,
  ): StudentPolicyView | null;
  resolveStudentPolicy(
    token: string,
    nowIso?: string,
    options?: AdminDbPolicyOptions,
  ): StudentPolicyView | null;
  close(): void;
}

interface PolicyRow {
  policy_id: string;
  owner_admin_id: string;
  title: string;
  status: string;
  ai_enabled: number;
  ai_level: number;
  ai_allow_student_api_key: number;
  editor_show_settings: number;
  editor_allow_sb3_export: number;
  editor_allow_sb3_import: number;
  editor_allow_extensions: number;
  collab_allow: number;
  drive_allow: number;
  roster_id: string | null;
  student_auth_required: number;
  submission_enabled: number;
  submission_drive_folder_id: string | null;
  created_at: string;
  updated_at: string;
}

interface LinkRow {
  link_id: string;
  policy_id: string;
  owner_admin_id: string;
  token: string;
  label: string;
  status: string;
  expires_at: string | null;
  created_at: string;
  revoked_at: string | null;
}

interface AdminRow {
  admin_id: string;
  subject: string;
  email: string;
  display_name: string | null;
  status: string;
  created_at: string;
  updated_at: string;
}

function configureSqlite(db: Database.Database): void {
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  db.pragma("busy_timeout = 5000");
}

function migrate(db: Database.Database): void {
  runAdminDbMigrations(db, ADMIN_DB_MIGRATIONS);
}

function rowToAdmin(row: AdminRow): AdminAccount {
  return {
    adminId: row.admin_id,
    subject: row.subject,
    email: row.email,
    displayName: row.display_name,
    status: row.status === "disabled" ? "disabled" : "active",
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function rowToPolicy(row: PolicyRow): ClassroomPolicy {
  return {
    policyId: row.policy_id,
    ownerAdminId: row.owner_admin_id,
    title: row.title,
    status: row.status === "disabled" ? "disabled" : "active",
    aiAssist: {
      enabled: Boolean(row.ai_enabled),
      level: Math.min(6, Math.max(0, row.ai_level)) as ClassroomPolicy["aiAssist"]["level"],
      allowStudentApiKey: Boolean(row.ai_allow_student_api_key),
    },
    editor: {
      showSettingsPanel: Boolean(row.editor_show_settings),
      allowSb3Export: Boolean(row.editor_allow_sb3_export),
      allowSb3Import: Boolean(row.editor_allow_sb3_import),
      allowExtensions: Boolean(row.editor_allow_extensions ?? 1),
    },
    collab: {allow: Boolean(row.collab_allow)},
    drive: {allow: Boolean(row.drive_allow)},
    rosterId: row.roster_id ?? null,
    submissionDriveFolderId: row.submission_drive_folder_id ?? null,
    studentAuth: {required: Boolean(row.student_auth_required)},
    submission: {enabled: Boolean(row.submission_enabled)},
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function rowToLink(row: LinkRow): StudentLink {
  return {
    linkId: row.link_id,
    policyId: row.policy_id,
    ownerAdminId: row.owner_admin_id,
    token: row.token,
    label: row.label,
    status: row.status === "revoked" ? "revoked" : "active",
    expiresAt: row.expires_at,
    createdAt: row.created_at,
    revokedAt: row.revoked_at,
  };
}

function toListItem(link: StudentLink): StudentLinkListItem {
  return {
    linkId: link.linkId,
    policyId: link.policyId,
    label: link.label,
    status: link.status,
    expiresAt: link.expiresAt,
    createdAt: link.createdAt,
    revokedAt: link.revokedAt,
  };
}

function nowIso(): string {
  return new Date().toISOString();
}

function stripRosterPolicyPatch(patch: ClassroomPolicyInput): ClassroomPolicyInput {
  const {rosterId: _rosterId, studentAuth: _studentAuth, ...rest} = patch;
  return rest;
}

function stripSubmissionPolicyPatch(patch: ClassroomPolicyInput): ClassroomPolicyInput {
  const {
    submissionDriveFolderId: _folderId,
    submission: _submission,
    ...rest
  } = patch;
  return rest;
}

function effectivePolicyPatch(
  patch: ClassroomPolicyInput,
  options?: AdminDbPolicyOptions,
): ClassroomPolicyInput {
  let next = patch;
  if (!options?.classroomRosterEnabled) {
    next = stripRosterPolicyPatch(next);
  }
  if (!options?.teacherDriveSubmissionEnabled) {
    next = stripSubmissionPolicyPatch(next);
  }
  return next;
}

export function openAdminDb(dbPath: string): AdminDb {
  if (dbPath !== ":memory:") {
    mkdirSync(dirname(dbPath), {recursive: true});
  }
  const db = new Database(dbPath);
  configureSqlite(db);
  migrate(db);

  const insertPolicy = db.prepare(`
    INSERT INTO classroom_policies (
      policy_id, owner_admin_id, title, status,
      ai_enabled, ai_level, ai_allow_student_api_key,
      editor_show_settings, editor_allow_sb3_export, editor_allow_sb3_import,
      editor_allow_extensions,
      collab_allow, drive_allow,
      roster_id, student_auth_required, submission_enabled,
      submission_drive_folder_id,
      created_at, updated_at
    ) VALUES (
      @policy_id, @owner_admin_id, @title, @status,
      @ai_enabled, @ai_level, @ai_allow_student_api_key,
      @editor_show_settings, @editor_allow_sb3_export, @editor_allow_sb3_import,
      @editor_allow_extensions,
      @collab_allow, @drive_allow,
      @roster_id, @student_auth_required, @submission_enabled,
      @submission_drive_folder_id,
      @created_at, @updated_at
    )
  `);

  const updatePolicyStmt = db.prepare(`
    UPDATE classroom_policies SET
      title = @title,
      status = @status,
      ai_enabled = @ai_enabled,
      ai_level = @ai_level,
      ai_allow_student_api_key = @ai_allow_student_api_key,
      editor_show_settings = @editor_show_settings,
      editor_allow_sb3_export = @editor_allow_sb3_export,
      editor_allow_sb3_import = @editor_allow_sb3_import,
      editor_allow_extensions = @editor_allow_extensions,
      collab_allow = @collab_allow,
      drive_allow = @drive_allow,
      roster_id = @roster_id,
      student_auth_required = @student_auth_required,
      submission_enabled = @submission_enabled,
      submission_drive_folder_id = @submission_drive_folder_id,
      updated_at = @updated_at
    WHERE policy_id = @policy_id AND owner_admin_id = @owner_admin_id
  `);

  const rosterOwnedByAdminStmt = db.prepare(`
    SELECT 1 AS ok FROM classroom_rosters
    WHERE roster_id = ? AND owner_admin_id = ?
    LIMIT 1
  `);

  function rosterOwnedByAdmin(rosterId: string, ownerAdminId: string): boolean {
    return rosterOwnedByAdminStmt.get(rosterId, ownerAdminId) != null;
  }

  function validateRosterPatchOwnership(
    patch: ClassroomPolicyInput,
    ownerAdminId: string,
    classroomRosterEnabled: boolean,
  ): PolicyWriteResult | {ok: true} {
    if (!classroomRosterEnabled) return {ok: true};
    if (patch.rosterId === undefined || patch.rosterId === null) return {ok: true};
    if (!rosterOwnedByAdmin(patch.rosterId, ownerAdminId)) {
      return {ok: false, kind: "not_found"};
    }
    return {ok: true};
  }

  function validateRosterPolicyFields(
    policy: ClassroomPolicy,
    classroomRosterEnabled: boolean,
  ): PolicyWriteResult | {ok: true} {
    if (!classroomRosterEnabled) return {ok: true};
    if (policy.studentAuth.required && !policy.rosterId) {
      return {
        ok: false,
        kind: "bad_request",
        code: "AUTH_REQUIRES_ROSTER",
        message: "studentAuth.required には rosterId が必要です。",
      };
    }
    return {ok: true};
  }

  function validateSubmissionPolicyFields(
    policy: ClassroomPolicy,
    teacherDriveSubmissionEnabled: boolean,
  ): PolicyWriteResult | {ok: true} {
    if (!teacherDriveSubmissionEnabled) return {ok: true};
    if (policy.submission.enabled && !policy.submissionDriveFolderId) {
      return {
        ok: false,
        kind: "bad_request",
        code: "SUBMISSION_REQUIRES_FOLDER",
        message: "submission.enabled には submissionDriveFolderId が必要です。",
      };
    }
    return {ok: true};
  }

  function studentViewOptions(
    options?: AdminDbPolicyOptions,
  ): {
    classroomRosterEnabled: boolean;
    teacherDriveSubmissionEnabled: boolean;
  } {
    return {
      classroomRosterEnabled: options?.classroomRosterEnabled ?? false,
      teacherDriveSubmissionEnabled: options?.teacherDriveSubmissionEnabled ?? false,
    };
  }

  function bindPolicy(policy: ClassroomPolicy): Record<string, unknown> {
    return {
      policy_id: policy.policyId,
      owner_admin_id: policy.ownerAdminId,
      title: policy.title,
      status: policy.status,
      ai_enabled: policy.aiAssist.enabled ? 1 : 0,
      ai_level: policy.aiAssist.level,
      ai_allow_student_api_key: policy.aiAssist.allowStudentApiKey ? 1 : 0,
      editor_show_settings: policy.editor.showSettingsPanel ? 1 : 0,
      editor_allow_sb3_export: policy.editor.allowSb3Export ? 1 : 0,
      editor_allow_sb3_import: policy.editor.allowSb3Import ? 1 : 0,
      editor_allow_extensions: policy.editor.allowExtensions ? 1 : 0,
      collab_allow: policy.collab.allow ? 1 : 0,
      drive_allow: policy.drive.allow ? 1 : 0,
      roster_id: policy.rosterId,
      student_auth_required: policy.studentAuth.required ? 1 : 0,
      submission_enabled: policy.submission.enabled ? 1 : 0,
      submission_drive_folder_id: policy.submissionDriveFolderId,
      created_at: policy.createdAt,
      updated_at: policy.updatedAt,
    };
  }

  return {
    sqlite: db,
    upsertAdminFromLogin(input) {
      const email = normalizeEmail(input.email);
      const existing = db
        .prepare(`SELECT * FROM admin_accounts WHERE subject = ?`)
        .get(input.subject) as AdminRow | undefined;
      const ts = nowIso();
      if (existing) {
        db.prepare(
          `UPDATE admin_accounts
           SET email = ?, display_name = ?, updated_at = ?
           WHERE admin_id = ?`,
        ).run(email, input.displayName, ts, existing.admin_id);
        return rowToAdmin({
          ...existing,
          email,
          display_name: input.displayName,
          updated_at: ts,
        });
      }
      const adminId = createOpaqueId();
      db.prepare(
        `INSERT INTO admin_accounts (
          admin_id, subject, email, display_name, status, created_at, updated_at
        ) VALUES (?, ?, ?, ?, 'active', ?, ?)`,
      ).run(adminId, input.subject, email, input.displayName, ts, ts);
      return {
        adminId,
        subject: input.subject,
        email,
        displayName: input.displayName,
        status: "active",
        createdAt: ts,
        updatedAt: ts,
      };
    },

    getAdminById(adminId) {
      const row = db
        .prepare(`SELECT * FROM admin_accounts WHERE admin_id = ?`)
        .get(adminId) as AdminRow | undefined;
      return row ? rowToAdmin(row) : null;
    },

    listPolicies(ownerAdminId) {
      const rows = db
        .prepare(
          `SELECT * FROM classroom_policies
           WHERE owner_admin_id = ?
           ORDER BY created_at DESC`,
        )
        .all(ownerAdminId) as PolicyRow[];
      return rows.map(rowToPolicy);
    },

    getPolicy(policyId, ownerAdminId) {
      const row = ownerAdminId
        ? (db
            .prepare(
              `SELECT * FROM classroom_policies
               WHERE policy_id = ? AND owner_admin_id = ?`,
            )
            .get(policyId, ownerAdminId) as PolicyRow | undefined)
        : (db
            .prepare(`SELECT * FROM classroom_policies WHERE policy_id = ?`)
            .get(policyId) as PolicyRow | undefined);
      return row ? rowToPolicy(row) : null;
    },

    createPolicy(ownerAdminId, input, options) {
      const classroomRosterEnabled = options?.classroomRosterEnabled ?? false;
      const teacherDriveSubmissionEnabled =
        options?.teacherDriveSubmissionEnabled ?? false;
      const effectiveInput = effectivePolicyPatch(input, options);
      const ownership = validateRosterPatchOwnership(
        effectiveInput,
        ownerAdminId,
        classroomRosterEnabled,
      );
      if (!ownership.ok) return ownership;
      const normalized = normalizeClassroomPolicyInput(effectiveInput);
      const ts = nowIso();
      const policy: ClassroomPolicy = {
        policyId: createOpaqueId(),
        ownerAdminId,
        createdAt: ts,
        updatedAt: ts,
        ...normalized,
      };
      const rosterValidation = validateRosterPolicyFields(
        policy,
        classroomRosterEnabled,
      );
      if (!rosterValidation.ok) return rosterValidation;
      const submissionValidation = validateSubmissionPolicyFields(
        policy,
        teacherDriveSubmissionEnabled,
      );
      if (!submissionValidation.ok) return submissionValidation;
      insertPolicy.run(bindPolicy(policy));
      return {ok: true, policy};
    },

    updatePolicy(policyId, ownerAdminId, patch, options) {
      const classroomRosterEnabled = options?.classroomRosterEnabled ?? false;
      const teacherDriveSubmissionEnabled =
        options?.teacherDriveSubmissionEnabled ?? false;
      const existing = this.getPolicy(policyId, ownerAdminId);
      if (!existing) return {ok: false, kind: "not_found"};
      const effectivePatch = effectivePolicyPatch(patch, options);
      const ownership = validateRosterPatchOwnership(
        effectivePatch,
        ownerAdminId,
        classroomRosterEnabled,
      );
      if (!ownership.ok) return ownership;
      const next = mergeClassroomPolicy(existing, effectivePatch, nowIso());
      const rosterValidation = validateRosterPolicyFields(
        next,
        classroomRosterEnabled,
      );
      if (!rosterValidation.ok) return rosterValidation;
      const submissionValidation = validateSubmissionPolicyFields(
        next,
        teacherDriveSubmissionEnabled,
      );
      if (!submissionValidation.ok) return submissionValidation;
      updatePolicyStmt.run(bindPolicy(next));
      return {ok: true, policy: next};
    },

    listLinks(ownerAdminId, policyId) {
      const rows = (
        policyId
          ? db
              .prepare(
                `SELECT * FROM student_links
                 WHERE owner_admin_id = ? AND policy_id = ?
                 ORDER BY created_at DESC`,
              )
              .all(ownerAdminId, policyId)
          : db
              .prepare(
                `SELECT * FROM student_links
                 WHERE owner_admin_id = ?
                 ORDER BY created_at DESC`,
              )
              .all(ownerAdminId)
      ) as LinkRow[];
      return rows.map(row => toListItem(rowToLink(row)));
    },

    createLink(input) {
      const policy = this.getPolicy(input.policyId, input.ownerAdminId);
      if (!policy) return null;
      const ts = nowIso();
      const link: StudentLink = {
        linkId: createOpaqueId(),
        policyId: input.policyId,
        ownerAdminId: input.ownerAdminId,
        token: createStudentLinkToken(),
        label: input.label.trim().slice(0, 120) || "生徒用リンク",
        status: "active",
        expiresAt: input.expiresAt ?? null,
        createdAt: ts,
        revokedAt: null,
      };
      db.prepare(
        `INSERT INTO student_links (
          link_id, policy_id, owner_admin_id, token, label,
          status, expires_at, created_at, revoked_at
        ) VALUES (?, ?, ?, ?, ?, 'active', ?, ?, NULL)`,
      ).run(
        link.linkId,
        link.policyId,
        link.ownerAdminId,
        link.token,
        link.label,
        link.expiresAt,
        link.createdAt,
      );
      return link;
    },

    revokeLink(linkId, ownerAdminId) {
      const row = db
        .prepare(
          `SELECT * FROM student_links
           WHERE link_id = ? AND owner_admin_id = ?`,
        )
        .get(linkId, ownerAdminId) as LinkRow | undefined;
      if (!row) return null;
      const ts = nowIso();
      db.prepare(
        `UPDATE student_links
         SET status = 'revoked', revoked_at = ?
         WHERE link_id = ?`,
      ).run(ts, linkId);
      return toListItem(
        rowToLink({...row, status: "revoked", revoked_at: ts}),
      );
    },

    reissueLink(linkId, ownerAdminId, expiresAt = null) {
      const row = db
        .prepare(
          `SELECT * FROM student_links
           WHERE link_id = ? AND owner_admin_id = ?`,
        )
        .get(linkId, ownerAdminId) as LinkRow | undefined;
      if (!row) return null;
      this.revokeLink(linkId, ownerAdminId);
      return this.createLink({
        ownerAdminId,
        policyId: row.policy_id,
        label: row.label,
        expiresAt,
      });
    },

    resolveStudentPolicy(token, now = nowIso(), options) {
      const row = db
        .prepare(
          `SELECT l.*, p.status AS policy_status,
                  p.title, p.ai_enabled, p.ai_level, p.ai_allow_student_api_key,
                  p.editor_show_settings, p.editor_allow_sb3_export,
                  p.editor_allow_sb3_import, p.editor_allow_extensions,
                  p.collab_allow, p.drive_allow,
                  p.roster_id, p.student_auth_required, p.submission_enabled,
                  p.submission_drive_folder_id,
                  p.policy_id AS p_policy_id, p.owner_admin_id AS p_owner,
                  p.created_at AS p_created, p.updated_at AS p_updated
           FROM student_links l
           JOIN classroom_policies p ON p.policy_id = l.policy_id
           WHERE l.token = ?`,
        )
        .get(token) as
        | (LinkRow & {
            policy_status: string;
            title: string;
            ai_enabled: number;
            ai_level: number;
            ai_allow_student_api_key: number;
            editor_show_settings: number;
            editor_allow_sb3_export: number;
            editor_allow_sb3_import: number;
            editor_allow_extensions: number;
            collab_allow: number;
            drive_allow: number;
            roster_id: string | null;
            student_auth_required: number;
            submission_enabled: number;
            submission_drive_folder_id: string | null;
            p_policy_id: string;
            p_owner: string;
            p_created: string;
            p_updated: string;
          })
        | undefined;
      if (!row) return null;
      if (row.status !== "active") return null;
      if (row.policy_status !== "active") return null;
      if (row.expires_at && row.expires_at <= now) return null;
      const policy = rowToPolicy({
        policy_id: row.p_policy_id,
        owner_admin_id: row.p_owner,
        title: row.title,
        status: row.policy_status,
        ai_enabled: row.ai_enabled,
        ai_level: row.ai_level,
        ai_allow_student_api_key: row.ai_allow_student_api_key,
        editor_show_settings: row.editor_show_settings,
        editor_allow_sb3_export: row.editor_allow_sb3_export,
        editor_allow_sb3_import: row.editor_allow_sb3_import,
        editor_allow_extensions: row.editor_allow_extensions,
        collab_allow: row.collab_allow,
        drive_allow: row.drive_allow,
        roster_id: row.roster_id,
        student_auth_required: row.student_auth_required,
        submission_enabled: row.submission_enabled,
        submission_drive_folder_id: row.submission_drive_folder_id ?? null,
        created_at: row.p_created,
        updated_at: row.p_updated,
      });
      return toStudentPolicyView(policy, studentViewOptions(options));
    },

    createStudentGrant(token, grantTtlMs = STUDENT_GRANT_TTL_MS, now = nowIso()) {
      const row = db
        .prepare(
          `SELECT link_id FROM student_links
           WHERE token = ? AND status = 'active'
             AND (expires_at IS NULL OR expires_at > ?)`,
        )
        .get(token, now) as {link_id: string} | undefined;
      if (!row) return null;
      const policyRow = db
        .prepare(
          `SELECT p.status AS policy_status
           FROM student_links l
           JOIN classroom_policies p ON p.policy_id = l.policy_id
           WHERE l.link_id = ?`,
        )
        .get(row.link_id) as {policy_status: string} | undefined;
      if (!policyRow || policyRow.policy_status !== "active") return null;

      const grantId = createGrantId();
      const grantExpires = new Date(Date.parse(now) + grantTtlMs).toISOString();
      db.prepare(
        `INSERT INTO student_grants (grant_id, link_id, expires_at, created_at)
         VALUES (?, ?, ?, ?)`,
      ).run(grantId, row.link_id, grantExpires, now);
      return {grantId, expiresAt: grantExpires};
    },

    resolveStudentPolicyByGrant(grantId, now = nowIso(), options) {
      const grant = db
        .prepare(`SELECT link_id, expires_at FROM student_grants WHERE grant_id = ?`)
        .get(grantId) as {link_id: string; expires_at: string} | undefined;
      if (!grant || grant.expires_at <= now) return null;

      const row = db
        .prepare(
          `SELECT l.*, p.status AS policy_status,
                  p.title, p.ai_enabled, p.ai_level, p.ai_allow_student_api_key,
                  p.editor_show_settings, p.editor_allow_sb3_export,
                  p.editor_allow_sb3_import, p.editor_allow_extensions,
                  p.collab_allow, p.drive_allow,
                  p.roster_id, p.student_auth_required, p.submission_enabled,
                  p.submission_drive_folder_id,
                  p.policy_id AS p_policy_id, p.owner_admin_id AS p_owner,
                  p.created_at AS p_created, p.updated_at AS p_updated
           FROM student_links l
           JOIN classroom_policies p ON p.policy_id = l.policy_id
           WHERE l.link_id = ?`,
        )
        .get(grant.link_id) as
        | (LinkRow & {
            policy_status: string;
            title: string;
            ai_enabled: number;
            ai_level: number;
            ai_allow_student_api_key: number;
            editor_show_settings: number;
            editor_allow_sb3_export: number;
            editor_allow_sb3_import: number;
            editor_allow_extensions: number;
            collab_allow: number;
            drive_allow: number;
            roster_id: string | null;
            student_auth_required: number;
            submission_enabled: number;
            submission_drive_folder_id: string | null;
            p_policy_id: string;
            p_owner: string;
            p_created: string;
            p_updated: string;
          })
        | undefined;
      if (!row) return null;
      if (row.status !== "active") return null;
      if (row.policy_status !== "active") return null;
      if (row.expires_at && row.expires_at <= now) return null;
      const policy = rowToPolicy({
        policy_id: row.p_policy_id,
        owner_admin_id: row.p_owner,
        title: row.title,
        status: row.policy_status,
        ai_enabled: row.ai_enabled,
        ai_level: row.ai_level,
        ai_allow_student_api_key: row.ai_allow_student_api_key,
        editor_show_settings: row.editor_show_settings,
        editor_allow_sb3_export: row.editor_allow_sb3_export,
        editor_allow_sb3_import: row.editor_allow_sb3_import,
        editor_allow_extensions: row.editor_allow_extensions,
        collab_allow: row.collab_allow,
        drive_allow: row.drive_allow,
        roster_id: row.roster_id,
        student_auth_required: row.student_auth_required,
        submission_enabled: row.submission_enabled,
        submission_drive_folder_id: row.submission_drive_folder_id ?? null,
        created_at: row.p_created,
        updated_at: row.p_updated,
      });
      return toStudentPolicyView(policy, studentViewOptions(options));
    },

    close() {
      db.close();
    },
  };
}

export function defaultAdminDbPath(
  env: NodeJS.ProcessEnv = process.env,
): string {
  if (env.ADMIN_DB_PATH?.trim()) return env.ADMIN_DB_PATH.trim();
  if (env.SYNCRATCH_DATA_DIR?.trim()) {
    return `${env.SYNCRATCH_DATA_DIR.trim().replace(/\/$/, "")}/admin.sqlite`;
  }
  return "./data/admin.sqlite";
}
