/**
 * Classroom roster CRUD and CSV import preview/apply (SQLite).
 */
import type Database from "better-sqlite3";
import {
  createOpaqueId,
  type ClassroomRoster,
  type ClassroomRosterInput,
  type ClassroomRosterListItem,
  type ClassroomRosterSyncStatus,
  type ClassroomStudentInput,
  type ClassroomStudentListItem,
  type StudentAccountStatus,
  type RosterImport,
  type RosterImportPreview,
  type RosterImportPreviewCategory,
  type RosterImportStatus,
  type RosterSyncResult,
} from "@blocksync/classroom-access";
import {
  buildImportPreviewRows,
  computePreviewHash,
  hasBlockingPreviewRows,
  RosterCsvParseError,
  parseRosterCsv,
  previewRowsToContract,
  type ExistingRosterStudent,
  type PreviewRowDraft,
} from "./roster-import.js";
import {
  pullSheetParsedRows,
  SheetSyncError,
  type RosterSheetSyncEnvironment,
} from "./roster-sheet-sync.js";
import {ensureStudentAccount} from "./student-auth.js";

export {SheetSyncError, type RosterSheetSyncEnvironment} from "./roster-sheet-sync.js";

export class RosterServiceError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "RosterServiceError";
  }
}

interface RosterRow {
  roster_id: string;
  owner_admin_id: string;
  title: string;
  sheet_spreadsheet_id: string | null;
  sheet_tab_name: string | null;
  sheet_range: string | null;
  sync_status: string;
  roster_revision: number;
  created_at: string;
  updated_at: string;
}

interface StudentRow {
  student_id: string;
  owner_admin_id: string;
  student_code: string;
  display_name: string;
  attendance_number: string | null;
  login_name: string | null;
  group_label: string | null;
  active: number;
  archived_at: string | null;
  created_at: string;
  updated_at: string;
  account_status?: string | null;
  account_updated_at?: string | null;
  account_created_at?: string | null;
}

interface ImportRow {
  import_id: string;
  roster_id: string;
  status: string;
  uploaded_at: string;
  preview_hash: string | null;
  base_roster_revision: number | null;
  applied_at: string | null;
  created_at: string;
  updated_at: string;
}

interface ImportPreviewRow {
  row_id: string;
  import_id: string;
  row_number: number;
  category: string;
  student_id: string | null;
  proposed_json: string;
  issues_json: string;
}

function nowIso(): string {
  return new Date().toISOString();
}

function rowToRoster(row: RosterRow): ClassroomRoster {
  return {
    rosterId: row.roster_id,
    ownerAdminId: row.owner_admin_id,
    title: row.title,
    sheetSpreadsheetId: row.sheet_spreadsheet_id,
    sheetTabName: row.sheet_tab_name,
    sheetRange: row.sheet_range,
    syncStatus: row.sync_status === "sync_required" ? "sync_required" : "active",
    rosterRevision: row.roster_revision,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function rowToImport(row: ImportRow): RosterImport {
  return {
    importId: row.import_id,
    rosterId: row.roster_id,
    status: row.status as RosterImportStatus,
    uploadedAt: row.uploaded_at,
    previewHash: row.preview_hash,
    baseRosterRevision: row.base_roster_revision,
    appliedAt: row.applied_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function parseAccountStatus(
  value: string | null | undefined,
): StudentAccountStatus | null {
  if (
    value === "pending_activation" ||
    value === "active" ||
    value === "disabled"
  ) {
    return value;
  }
  return null;
}

function rowToStudentListItem(row: StudentRow): ClassroomStudentListItem {
  const accountStatus = parseAccountStatus(row.account_status);
  return {
    studentId: row.student_id,
    studentCode: row.student_code,
    displayName: row.display_name,
    attendanceNumber: row.attendance_number,
    loginName: row.login_name,
    groupLabel: row.group_label,
    active: Boolean(row.active),
    accountStatus,
    firstRegisteredAt:
      accountStatus === "active" ? (row.account_updated_at ?? null) : null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function existingFromRow(row: StudentRow): ExistingRosterStudent {
  return {
    studentId: row.student_id,
    studentCode: row.student_code,
    displayName: row.display_name,
    attendanceNumber: row.attendance_number,
    loginName: row.login_name,
    groupLabel: row.group_label,
    active: Boolean(row.active),
  };
}

function proposedChanged(
  draft: PreviewRowDraft,
  existing: ExistingRosterStudent | undefined,
): boolean {
  if (draft.category === "add" || draft.category === "deactivate") return true;
  if (draft.category !== "update" || !existing) return false;
  const proposed = draft.proposed as {
    studentCode?: string;
    displayName?: string;
    attendanceNumber?: string | null;
    loginName?: string;
    groupLabel?: string | null;
    active?: boolean;
  };
  return !(
    proposed.displayName === existing.displayName &&
    proposed.attendanceNumber === existing.attendanceNumber &&
    (proposed.loginName ?? proposed.studentCode ?? existing.studentCode) ===
      (existing.loginName ?? existing.studentCode) &&
    proposed.groupLabel === existing.groupLabel &&
    proposed.active === existing.active
  );
}

export interface RosterService {
  listRosters(ownerAdminId: string): ClassroomRosterListItem[];
  createRoster(
    ownerAdminId: string,
    input: ClassroomRosterInput,
  ): ClassroomRoster;
  getRoster(rosterId: string, ownerAdminId: string): ClassroomRoster | null;
  updateRoster(
    rosterId: string,
    ownerAdminId: string,
    patch: ClassroomRosterInput,
  ): ClassroomRoster | null;
  listStudents(
    rosterId: string,
    ownerAdminId: string,
  ): ClassroomStudentListItem[];
  addStudent(
    rosterId: string,
    ownerAdminId: string,
    input: ClassroomStudentInput,
  ): ClassroomStudentListItem;
  createImportFromCsv(
    rosterId: string,
    ownerAdminId: string,
    csvText: string,
    options?: {deactivateMissing?: boolean},
  ): RosterImportPreview;
  getImport(
    rosterId: string,
    importId: string,
    ownerAdminId: string,
  ): RosterImport | null;
  getImportPreview(
    rosterId: string,
    importId: string,
    ownerAdminId: string,
  ): RosterImportPreview | null;
  applyImport(input: {
    rosterId: string;
    importId: string;
    ownerAdminId: string;
    previewHash: string;
    baseRosterRevision: number;
    deactivateMissing: boolean;
  }): {roster: ClassroomRoster; import: RosterImport};
}

function ignoredColumnsFromDrafts(drafts: PreviewRowDraft[]): string[] {
  const cols = new Set<string>();
  for (const draft of drafts) {
    for (const issue of draft.issues) {
      if (issue.code !== "UNKNOWN_COLUMN") continue;
      const prefix = "Unknown columns ignored: ";
      if (issue.message.startsWith(prefix)) {
        for (const col of issue.message.slice(prefix.length).split(", ")) {
          if (col) cols.add(col);
        }
      }
    }
  }
  return [...cols].sort();
}

function csvCodesFromDrafts(drafts: PreviewRowDraft[]): Set<string> {
  const codes = new Set<string>();
  for (const draft of drafts) {
    if (draft.rowNumber <= 0 || draft.category === "rejected_row") continue;
    const code = (draft.proposed as {studentCode?: string}).studentCode;
    if (code) codes.add(code);
  }
  return codes;
}

function missingFromCsvCount(
  rosterMembers: ExistingRosterStudent[],
  drafts: PreviewRowDraft[],
): number {
  const csvCodes = csvCodesFromDrafts(drafts);
  return rosterMembers.filter(
    member => member.active && !csvCodes.has(member.studentCode),
  ).length;
}

function resolveDeactivateMissing(
  importRecord: RosterImport,
  drafts: PreviewRowDraft[],
): boolean {
  for (const flag of [false, true] as const) {
    const hash = computePreviewHash({
      baseRosterRevision: importRecord.baseRosterRevision!,
      deactivateMissing: flag,
      rows: drafts,
    });
    if (hash === importRecord.previewHash) return flag;
  }
  throw new RosterServiceError(
    "STALE_PREVIEW",
    "Import preview hash does not match stored rows",
  );
}

function buildPreviewResponse(input: {
  importRecord: RosterImport;
  drafts: PreviewRowDraft[];
  rowIds: string[];
  rosterMembers: ExistingRosterStudent[];
  deactivateMissing: boolean;
  ignoredColumns: string[];
  missingCount: number;
  previewHash: string;
  baseRosterRevision: number;
}): RosterImportPreview {
  return {
    import: input.importRecord,
    rows: previewRowsToContract(
      input.importRecord.importId,
      input.drafts,
      input.rowIds,
    ),
    previewHash: input.previewHash,
    baseRosterRevision: input.baseRosterRevision,
    ignoredColumns: input.ignoredColumns,
    missingFromCsvCount: input.missingCount,
    deactivateMissing: input.deactivateMissing,
  };
}

function filterApplicableDrafts(
  db: Database.Database,
  drafts: PreviewRowDraft[],
): PreviewRowDraft[] {
  return drafts.filter(draft => {
    if (
      draft.category === "duplicate_candidate" ||
      draft.category === "attendance_collision" ||
      draft.category === "rejected_row" ||
      draft.category === "unchanged"
    ) {
      return false;
    }
    if (draft.category === "update") {
      const existing = draft.studentId
        ? (db
            .prepare(`SELECT * FROM classroom_students WHERE student_id = ?`)
            .get(draft.studentId) as StudentRow | undefined)
        : undefined;
      return proposedChanged(
        draft,
        existing ? existingFromRow(existing) : undefined,
      );
    }
    return true;
  });
}

function applyDraftsToRoster(input: {
  db: Database.Database;
  rosterId: string;
  ownerAdminId: string;
  baseRosterRevision: number;
  drafts: PreviewRowDraft[];
  audit: {
    importId?: string;
    previewHash?: string;
    source: "import" | "sheet_sync";
  };
  syncStatus?: ClassroomRosterSyncStatus;
}): ClassroomRoster {
  const applicable = filterApplicableDrafts(input.db, input.drafts);
  const ts = nowIso();
  const insertAudit = input.db.prepare(
    `INSERT INTO classroom_audit_events (
      event_id, owner_admin_id, roster_id, student_id,
      event_type, payload_json, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
  );

  const tx = input.db.transaction(() => {
    const bump = input.db
      .prepare(
        `UPDATE classroom_rosters SET
          roster_revision = roster_revision + 1,
          sync_status = ?,
          updated_at = ?
         WHERE roster_id = ? AND owner_admin_id = ?
           AND roster_revision = ?`,
      )
      .run(
        input.syncStatus ?? "active",
        ts,
        input.rosterId,
        input.ownerAdminId,
        input.baseRosterRevision,
      );
    if (bump.changes === 0) {
      throw new RosterServiceError(
        "REVISION_CONFLICT",
        "Concurrent roster update",
      );
    }

    for (const draft of applicable) {
      const proposed = draft.proposed as {
        studentCode: string;
        displayName: string;
        attendanceNumber?: string | null;
        loginName?: string;
        groupLabel?: string | null;
        active?: boolean;
      };

      if (draft.category === "add") {
        const studentId = createOpaqueId();
        const membershipId = createOpaqueId();
        input.db
          .prepare(
            `INSERT INTO classroom_students (
              student_id, owner_admin_id, student_code, display_name,
              attendance_number, login_name, group_label, active,
              archived_at, created_at, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, 1, NULL, ?, ?)`,
          )
          .run(
            studentId,
            input.ownerAdminId,
            proposed.studentCode,
            proposed.displayName,
            proposed.attendanceNumber ?? null,
            proposed.loginName ?? proposed.studentCode,
            proposed.groupLabel ?? null,
            ts,
            ts,
          );
        input.db
          .prepare(
            `INSERT INTO classroom_roster_memberships (
              membership_id, roster_id, student_id, active,
              created_at, updated_at
            ) VALUES (?, ?, ?, 1, ?, ?)`,
          )
          .run(membershipId, input.rosterId, studentId, ts, ts);
        insertAudit.run(
          createOpaqueId(),
          input.ownerAdminId,
          input.rosterId,
          studentId,
          "roster.student.added",
          JSON.stringify({
            source: input.audit.source,
            importId: input.audit.importId,
            studentCode: proposed.studentCode,
            category: draft.category,
          }),
          ts,
        );
        continue;
      }

      if (draft.category === "update" && draft.studentId) {
        input.db
          .prepare(
            `UPDATE classroom_students SET
              display_name = ?,
              attendance_number = ?,
              login_name = ?,
              group_label = ?,
              active = ?,
              archived_at = CASE WHEN ? = 0 THEN ? ELSE NULL END,
              updated_at = ?
             WHERE student_id = ? AND owner_admin_id = ?`,
          )
          .run(
            proposed.displayName,
            proposed.attendanceNumber ?? null,
            proposed.loginName ?? proposed.studentCode,
            proposed.groupLabel ?? null,
            proposed.active ? 1 : 0,
            proposed.active ? 1 : 0,
            ts,
            ts,
            draft.studentId,
            input.ownerAdminId,
          );
        const existingMembership = input.db
          .prepare(
            `SELECT membership_id FROM classroom_roster_memberships
             WHERE roster_id = ? AND student_id = ?`,
          )
          .get(input.rosterId, draft.studentId) as
          | {membership_id: string}
          | undefined;
        if (existingMembership) {
          input.db
            .prepare(
              `UPDATE classroom_roster_memberships SET
                active = 1, updated_at = ?
               WHERE roster_id = ? AND student_id = ?`,
            )
            .run(ts, input.rosterId, draft.studentId);
        } else {
          input.db
            .prepare(
              `INSERT INTO classroom_roster_memberships (
                membership_id, roster_id, student_id, active,
                created_at, updated_at
              ) VALUES (?, ?, ?, 1, ?, ?)`,
            )
            .run(
              createOpaqueId(),
              input.rosterId,
              draft.studentId,
              ts,
              ts,
            );
        }
        insertAudit.run(
          createOpaqueId(),
          input.ownerAdminId,
          input.rosterId,
          draft.studentId,
          "roster.student.updated",
          JSON.stringify({
            source: input.audit.source,
            importId: input.audit.importId,
            studentCode: proposed.studentCode,
            category: draft.category,
          }),
          ts,
        );
        continue;
      }

      if (draft.category === "deactivate" && draft.studentId) {
        input.db
          .prepare(
            `UPDATE classroom_students SET
              active = 0, archived_at = ?, updated_at = ?
             WHERE student_id = ? AND owner_admin_id = ?`,
          )
          .run(ts, ts, draft.studentId, input.ownerAdminId);
        input.db
          .prepare(
            `UPDATE classroom_roster_memberships SET
              active = 0, updated_at = ?
             WHERE roster_id = ? AND student_id = ?`,
          )
          .run(ts, input.rosterId, draft.studentId);
        insertAudit.run(
          createOpaqueId(),
          input.ownerAdminId,
          input.rosterId,
          draft.studentId,
          "roster.student.deactivated",
          JSON.stringify({
            source: input.audit.source,
            importId: input.audit.importId,
            studentCode: proposed.studentCode,
            category: draft.category,
          }),
          ts,
        );
      }
    }

    if (input.audit.source === "import") {
      insertAudit.run(
        createOpaqueId(),
        input.ownerAdminId,
        input.rosterId,
        null,
        "roster.import.applied",
        JSON.stringify({
          importId: input.audit.importId,
          previewHash: input.audit.previewHash,
          baseRosterRevision: input.baseRosterRevision,
          mutationCount: applicable.length,
        }),
        ts,
      );
    } else {
      const deactivateCount = applicable.filter(
        draft => draft.category === "deactivate",
      ).length;
      insertAudit.run(
        createOpaqueId(),
        input.ownerAdminId,
        input.rosterId,
        null,
        "roster.sheet.synced",
        JSON.stringify({
          baseRosterRevision: input.baseRosterRevision,
          mutationCount: applicable.length,
          deactivateCount,
        }),
        ts,
      );
    }
  });

  tx();

  const row = input.db
    .prepare(
      `SELECT * FROM classroom_rosters
       WHERE roster_id = ? AND owner_admin_id = ?`,
    )
    .get(input.rosterId, input.ownerAdminId) as RosterRow;
  return rowToRoster(row);
}

export function markRosterSyncRequired(
  db: Database.Database,
  rosterId: string,
  ownerAdminId: string,
  reason: string,
): void {
  const ts = nowIso();
  db.prepare(
    `UPDATE classroom_rosters SET
      sync_status = 'sync_required',
      updated_at = ?
     WHERE roster_id = ? AND owner_admin_id = ?`,
  ).run(ts, rosterId, ownerAdminId);
  db.prepare(
    `INSERT INTO classroom_audit_events (
      event_id, owner_admin_id, roster_id, student_id,
      event_type, payload_json, created_at
    ) VALUES (?, ?, ?, NULL, 'roster.sheet.sync_required', ?, ?)`,
  ).run(createOpaqueId(), ownerAdminId, rosterId, JSON.stringify({reason}), ts);
}

function storeImportPreview(input: {
  db: Database.Database;
  rosterId: string;
  rosterRevision: number;
  rosterMembers: ExistingRosterStudent[];
  drafts: PreviewRowDraft[];
  deactivateMissing: boolean;
  ignoredColumns: string[];
  missingCount: number;
}): RosterImportPreview {
  const previewHash = computePreviewHash({
    baseRosterRevision: input.rosterRevision,
    deactivateMissing: input.deactivateMissing,
    rows: input.drafts,
  });
  const importId = createOpaqueId();
  const ts = nowIso();
  const rowIds = input.drafts.map(() => createOpaqueId());

  const tx = input.db.transaction(() => {
    input.db
      .prepare(
        `INSERT INTO roster_imports (
          import_id, roster_id, status, uploaded_at,
          preview_hash, base_roster_revision, applied_at,
          created_at, updated_at
        ) VALUES (?, ?, 'preview_ready', ?, ?, ?, NULL, ?, ?)`,
      )
      .run(
        importId,
        input.rosterId,
        ts,
        previewHash,
        input.rosterRevision,
        ts,
        ts,
      );
    const insertRow = input.db.prepare(
      `INSERT INTO roster_import_rows (
        row_id, import_id, row_number, category, student_id,
        proposed_json, issues_json
      ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
    );
    for (let i = 0; i < input.drafts.length; i++) {
      const draft = input.drafts[i]!;
      insertRow.run(
        rowIds[i],
        importId,
        draft.rowNumber,
        draft.category,
        draft.studentId,
        JSON.stringify(draft.proposed),
        JSON.stringify(draft.issues),
      );
    }
  });
  tx();

  const importRecord = rowToImport(
    input.db
      .prepare(`SELECT * FROM roster_imports WHERE import_id = ?`)
      .get(importId) as ImportRow,
  );
  return buildPreviewResponse({
    importRecord,
    drafts: input.drafts,
    rowIds,
    rosterMembers: input.rosterMembers,
    deactivateMissing: input.deactivateMissing,
    ignoredColumns: input.ignoredColumns,
    missingCount: input.missingCount,
    previewHash,
    baseRosterRevision: input.rosterRevision,
  });
}

export function createRosterService(db: Database.Database): RosterService {
  const getRosterStmt = db.prepare(`
    SELECT * FROM classroom_rosters
    WHERE roster_id = ? AND owner_admin_id = ?
  `);

  const listExistingStudentsStmt = db.prepare(`
    SELECT
      s.*,
      sa.status AS account_status,
      sa.updated_at AS account_updated_at,
      sa.created_at AS account_created_at
    FROM classroom_students s
    INNER JOIN classroom_roster_memberships m ON m.student_id = s.student_id
    LEFT JOIN student_accounts sa ON sa.student_id = s.student_id
    WHERE m.roster_id = ? AND s.owner_admin_id = ?
    ORDER BY s.student_code ASC
  `);

  const listOwnerStudentsStmt = db.prepare(`
    SELECT * FROM classroom_students
    WHERE owner_admin_id = ?
    ORDER BY student_code ASC
  `);

  function requireRoster(
    rosterId: string,
    ownerAdminId: string,
  ): ClassroomRoster {
    const row = getRosterStmt.get(rosterId, ownerAdminId) as
      | RosterRow
      | undefined;
    if (!row) {
      throw new RosterServiceError("ROSTER_NOT_FOUND", "Roster not found");
    }
    return rowToRoster(row);
  }

  function loadPreviewDrafts(importId: string): PreviewRowDraft[] {
    const rows = db
      .prepare(
        `SELECT * FROM roster_import_rows
         WHERE import_id = ?
         ORDER BY row_number ASC, row_id ASC`,
      )
      .all(importId) as ImportPreviewRow[];
    return rows.map(row => ({
      rowNumber: row.row_number,
      category: row.category as RosterImportPreviewCategory,
      studentId: row.student_id,
      proposed: JSON.parse(row.proposed_json) as Record<string, unknown>,
      issues: JSON.parse(row.issues_json) as PreviewRowDraft["issues"],
    }));
  }

  return {
    listRosters(ownerAdminId) {
      const rows = db
        .prepare(
          `SELECT r.*,
                  COUNT(CASE WHEN m.active = 1 THEN 1 END) AS student_count
           FROM classroom_rosters r
           LEFT JOIN classroom_roster_memberships m
             ON m.roster_id = r.roster_id
           WHERE r.owner_admin_id = ?
           GROUP BY r.roster_id
           ORDER BY r.created_at DESC`,
        )
        .all(ownerAdminId) as Array<RosterRow & {student_count: number}>;
      return rows.map(row => ({
        rosterId: row.roster_id,
        title: row.title,
        syncStatus:
          row.sync_status === "sync_required" ? "sync_required" : "active",
        rosterRevision: row.roster_revision,
        studentCount: row.student_count,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
      }));
    },

    createRoster(ownerAdminId, input) {
      const ts = nowIso();
      const roster: ClassroomRoster = {
        rosterId: createOpaqueId(),
        ownerAdminId,
        title: input.title?.trim() || "名簿",
        sheetSpreadsheetId: input.sheetSpreadsheetId ?? null,
        sheetTabName: input.sheetTabName ?? null,
        sheetRange: input.sheetRange ?? null,
        syncStatus: "active",
        rosterRevision: 0,
        createdAt: ts,
        updatedAt: ts,
      };
      db.prepare(
        `INSERT INTO classroom_rosters (
          roster_id, owner_admin_id, title,
          sheet_spreadsheet_id, sheet_tab_name, sheet_range,
          sync_status, roster_revision, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(
        roster.rosterId,
        roster.ownerAdminId,
        roster.title,
        roster.sheetSpreadsheetId,
        roster.sheetTabName,
        roster.sheetRange,
        roster.syncStatus,
        roster.rosterRevision,
        roster.createdAt,
        roster.updatedAt,
      );
      return roster;
    },

    getRoster(rosterId, ownerAdminId) {
      const row = getRosterStmt.get(rosterId, ownerAdminId) as
        | RosterRow
        | undefined;
      return row ? rowToRoster(row) : null;
    },

    updateRoster(rosterId, ownerAdminId, patch) {
      const existing = this.getRoster(rosterId, ownerAdminId);
      if (!existing) return null;
      const ts = nowIso();
      const next: ClassroomRoster = {
        ...existing,
        title: patch.title !== undefined ? patch.title.trim() || existing.title : existing.title,
        sheetSpreadsheetId:
          patch.sheetSpreadsheetId !== undefined
            ? patch.sheetSpreadsheetId
            : existing.sheetSpreadsheetId,
        sheetTabName:
          patch.sheetTabName !== undefined
            ? patch.sheetTabName
            : existing.sheetTabName,
        sheetRange:
          patch.sheetRange !== undefined ? patch.sheetRange : existing.sheetRange,
        updatedAt: ts,
      };
      db.prepare(
        `UPDATE classroom_rosters SET
          title = ?, sheet_spreadsheet_id = ?, sheet_tab_name = ?, sheet_range = ?,
          updated_at = ?
         WHERE roster_id = ? AND owner_admin_id = ?`,
      ).run(
        next.title,
        next.sheetSpreadsheetId,
        next.sheetTabName,
        next.sheetRange,
        next.updatedAt,
        rosterId,
        ownerAdminId,
      );
      return next;
    },

    listStudents(rosterId, ownerAdminId) {
      requireRoster(rosterId, ownerAdminId);
      const rows = listExistingStudentsStmt.all(
        rosterId,
        ownerAdminId,
      ) as StudentRow[];
      return rows.map(rowToStudentListItem);
    },

    addStudent(rosterId, ownerAdminId, input) {
      const roster = requireRoster(rosterId, ownerAdminId);
      const studentCode = input.studentCode?.trim() ?? "";
      const displayName = input.displayName?.trim() ?? "";
      if (!studentCode) {
        throw new RosterServiceError(
          "MISSING_STUDENT_CODE",
          "student_code is required",
        );
      }
      if (!displayName) {
        throw new RosterServiceError(
          "MISSING_DISPLAY_NAME",
          "display_name is required",
        );
      }

      const attendanceNumber =
        input.attendanceNumber === undefined
          ? null
          : input.attendanceNumber?.trim()
            ? input.attendanceNumber.trim()
            : null;
      const loginNameRaw = input.loginName?.trim() ?? "";
      const loginName = loginNameRaw || studentCode;
      const groupLabel =
        input.groupLabel === undefined
          ? null
          : input.groupLabel?.trim()
            ? input.groupLabel.trim()
            : null;
      const active = input.active ?? true;

      const existingByCode = db
        .prepare(
          `SELECT * FROM classroom_students
           WHERE owner_admin_id = ? AND student_code = ?`,
        )
        .get(ownerAdminId, studentCode) as StudentRow | undefined;
      if (existingByCode) {
        throw new RosterServiceError(
          "DUPLICATE_STUDENT_CODE",
          `student_code ${studentCode} already exists`,
        );
      }

      if (attendanceNumber) {
        const attendanceCollision = db
          .prepare(
            `SELECT student_id FROM classroom_students
             WHERE owner_admin_id = ? AND attendance_number = ? AND active = 1`,
          )
          .get(ownerAdminId, attendanceNumber) as {student_id: string} | undefined;
        if (attendanceCollision) {
          throw new RosterServiceError(
            "ATTENDANCE_COLLISION",
            `attendance_number ${attendanceNumber} already assigned`,
          );
        }
      }

      const studentId = createOpaqueId();
      const membershipId = createOpaqueId();
      const ts = nowIso();
      const tx = db.transaction(() => {
        const bump = db
          .prepare(
            `UPDATE classroom_rosters SET
              roster_revision = roster_revision + 1,
              sync_status = 'active',
              updated_at = ?
             WHERE roster_id = ? AND owner_admin_id = ?
               AND roster_revision = ?`,
          )
          .run(ts, rosterId, ownerAdminId, roster.rosterRevision);
        if (bump.changes === 0) {
          throw new RosterServiceError(
            "REVISION_CONFLICT",
            "Concurrent roster update",
          );
        }

        db.prepare(
          `INSERT INTO classroom_students (
            student_id, owner_admin_id, student_code, display_name,
            attendance_number, login_name, group_label, active,
            archived_at, created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?)`,
        ).run(
          studentId,
          ownerAdminId,
          studentCode,
          displayName,
          attendanceNumber,
          loginName,
          groupLabel,
          active ? 1 : 0,
          ts,
          ts,
        );
        db.prepare(
          `INSERT INTO classroom_roster_memberships (
            membership_id, roster_id, student_id, active,
            created_at, updated_at
          ) VALUES (?, ?, ?, 1, ?, ?)`,
        ).run(membershipId, rosterId, studentId, ts, ts);
        db.prepare(
          `INSERT INTO classroom_audit_events (
            event_id, owner_admin_id, roster_id, student_id,
            event_type, payload_json, created_at
          ) VALUES (?, ?, ?, ?, 'roster.student.added', ?, ?)`,
        ).run(
          createOpaqueId(),
          ownerAdminId,
          rosterId,
          studentId,
          JSON.stringify({
            source: "inline",
            studentCode,
          }),
          ts,
        );
        ensureStudentAccount(db, studentId, ts);
      });
      tx();

      const row = (
        listExistingStudentsStmt.all(rosterId, ownerAdminId) as StudentRow[]
      ).find(candidate => candidate.student_id === studentId);
      if (!row) {
        throw new RosterServiceError(
          "STUDENT_NOT_FOUND",
          "Added student could not be loaded",
        );
      }
      return rowToStudentListItem(row);
    },

    createImportFromCsv(rosterId, ownerAdminId, csvText, options = {}) {
      const roster = requireRoster(rosterId, ownerAdminId);
      const deactivateMissing = options.deactivateMissing ?? false;
      const rosterMemberRows = listExistingStudentsStmt.all(
        rosterId,
        ownerAdminId,
      ) as StudentRow[];
      const rosterMembers = rosterMemberRows.map(existingFromRow);
      const ownerRows = listOwnerStudentsStmt.all(ownerAdminId) as StudentRow[];

      let buildResult;
      try {
        const parsedRows = parseRosterCsv(csvText);
        buildResult = buildImportPreviewRows({
          parsedRows,
          existingStudents: ownerRows.map(existingFromRow),
          rosterMembers,
          deactivateMissing,
        });
      } catch (error) {
        if (error instanceof RosterCsvParseError) {
          buildResult = {
            rows: error.rejectedRows,
            ignoredColumns: [] as string[],
            missingFromCsvCount: missingFromCsvCount(rosterMembers, error.rejectedRows),
          };
        } else {
          throw error;
        }
      }

      const {rows: drafts, ignoredColumns, missingFromCsvCount: missingCount} =
        buildResult;
      return storeImportPreview({
        db,
        rosterId,
        rosterRevision: roster.rosterRevision,
        rosterMembers,
        drafts,
        deactivateMissing,
        ignoredColumns,
        missingCount,
      });
    },

    getImport(rosterId, importId, ownerAdminId) {
      requireRoster(rosterId, ownerAdminId);
      const row = db
        .prepare(
          `SELECT * FROM roster_imports
           WHERE import_id = ? AND roster_id = ?`,
        )
        .get(importId, rosterId) as ImportRow | undefined;
      return row ? rowToImport(row) : null;
    },

    getImportPreview(rosterId, importId, ownerAdminId) {
      const importRecord = this.getImport(rosterId, importId, ownerAdminId);
      if (!importRecord || importRecord.status !== "preview_ready") return null;
      const drafts = loadPreviewDrafts(importId);
      const rowIds = (
        db
          .prepare(
            `SELECT row_id FROM roster_import_rows
             WHERE import_id = ?
             ORDER BY row_number ASC, row_id ASC`,
          )
          .all(importId) as Array<{row_id: string}>
      ).map(row => row.row_id);
      const rosterMemberRows = listExistingStudentsStmt.all(
        rosterId,
        ownerAdminId,
      ) as StudentRow[];
      const rosterMembers = rosterMemberRows.map(existingFromRow);
      const deactivateMissing = resolveDeactivateMissing(importRecord, drafts);
      return buildPreviewResponse({
        importRecord,
        drafts,
        rowIds,
        rosterMembers,
        deactivateMissing,
        ignoredColumns: ignoredColumnsFromDrafts(drafts),
        missingCount: missingFromCsvCount(rosterMembers, drafts),
        previewHash: importRecord.previewHash!,
        baseRosterRevision: importRecord.baseRosterRevision!,
      });
    },

    applyImport(input) {
      const roster = requireRoster(input.rosterId, input.ownerAdminId);
      const importRecord = this.getImport(
        input.rosterId,
        input.importId,
        input.ownerAdminId,
      );
      if (!importRecord) {
        throw new RosterServiceError("IMPORT_NOT_FOUND", "Import not found");
      }
      if (importRecord.status !== "preview_ready") {
        throw new RosterServiceError(
          "IMPORT_NOT_APPLICABLE",
          "Import is not ready to apply",
        );
      }
      if (
        importRecord.previewHash !== input.previewHash ||
        importRecord.baseRosterRevision !== input.baseRosterRevision
      ) {
        throw new RosterServiceError(
          "STALE_PREVIEW",
          "Preview hash or roster revision is stale",
        );
      }

      const drafts = loadPreviewDrafts(input.importId);
      const hashWithFlag = computePreviewHash({
        baseRosterRevision: input.baseRosterRevision,
        deactivateMissing: input.deactivateMissing,
        rows: drafts,
      });
      if (hashWithFlag !== input.previewHash) {
        throw new RosterServiceError(
          "STALE_PREVIEW",
          "deactivateMissing does not match import preview",
        );
      }
      if (input.baseRosterRevision !== roster.rosterRevision) {
        throw new RosterServiceError(
          "STALE_PREVIEW",
          "Roster revision changed since preview",
        );
      }

      if (hasBlockingPreviewRows(drafts)) {
        throw new RosterServiceError(
          "BLOCKING_PREVIEW",
          "Import preview contains blocking rows",
        );
      }

      const ts = nowIso();
      const tx = db.transaction(() => {
        applyDraftsToRoster({
          db,
          rosterId: input.rosterId,
          ownerAdminId: input.ownerAdminId,
          baseRosterRevision: input.baseRosterRevision,
          drafts,
          audit: {
            source: "import",
            importId: input.importId,
            previewHash: input.previewHash,
          },
        });
        db.prepare(
          `UPDATE roster_imports SET
            status = 'applied', applied_at = ?, updated_at = ?
           WHERE import_id = ?`,
        ).run(ts, ts, input.importId);
      });
      tx();

      const nextRoster = this.getRoster(input.rosterId, input.ownerAdminId)!;
      const nextImport = this.getImport(
        input.rosterId,
        input.importId,
        input.ownerAdminId,
      )!;
      return {roster: nextRoster, import: nextImport};
    },
  };
}

export async function createSheetSyncPreview(
  db: Database.Database,
  sheetSync: RosterSheetSyncEnvironment,
  rosterId: string,
  ownerAdminId: string,
  options: {deactivateMissing?: boolean} = {},
): Promise<RosterImportPreview> {
  const getRosterStmt = db.prepare(`
    SELECT * FROM classroom_rosters
    WHERE roster_id = ? AND owner_admin_id = ?
  `);
  const listExistingStudentsStmt = db.prepare(`
    SELECT s.*
    FROM classroom_students s
    INNER JOIN classroom_roster_memberships m ON m.student_id = s.student_id
    WHERE m.roster_id = ? AND s.owner_admin_id = ?
    ORDER BY s.student_code ASC
  `);
  const listOwnerStudentsStmt = db.prepare(`
    SELECT * FROM classroom_students
    WHERE owner_admin_id = ?
    ORDER BY student_code ASC
  `);

  const row = getRosterStmt.get(rosterId, ownerAdminId) as RosterRow | undefined;
  if (!row) {
    throw new RosterServiceError("ROSTER_NOT_FOUND", "Roster not found");
  }
  const roster = rowToRoster(row);
  if (!roster.sheetSpreadsheetId) {
    throw new RosterServiceError(
      "SHEET_NOT_BOUND",
      "Roster is not bound to a Google Sheet",
    );
  }

  const deactivateMissing = options.deactivateMissing ?? false;
  const rosterMembers = (
    listExistingStudentsStmt.all(rosterId, ownerAdminId) as StudentRow[]
  ).map(existingFromRow);
  const ownerStudents = (
    listOwnerStudentsStmt.all(ownerAdminId) as StudentRow[]
  ).map(existingFromRow);

  let parsedRows;
  try {
    parsedRows = await pullSheetParsedRows(sheetSync, ownerAdminId, roster);
  } catch (error) {
    if (error instanceof SheetSyncError) {
      if (
        error.code === "SHEET_INACCESSIBLE" ||
        error.code === "SHEET_HEADER_INVALID" ||
        error.code === "SHEET_FETCH_FAILED"
      ) {
        markRosterSyncRequired(db, rosterId, ownerAdminId, error.code);
      }
      throw error;
    }
    throw error;
  }

  const {rows: drafts, ignoredColumns, missingFromCsvCount: missingCount} =
    buildImportPreviewRows({
      parsedRows,
      existingStudents: ownerStudents,
      rosterMembers,
      deactivateMissing,
    });

  return storeImportPreview({
    db,
    rosterId,
    rosterRevision: roster.rosterRevision,
    rosterMembers,
    drafts,
    deactivateMissing,
    ignoredColumns,
    missingCount,
  });
}

export function applySheetSync(
  db: Database.Database,
  input: {
    rosterId: string;
    importId: string;
    ownerAdminId: string;
    previewHash: string;
    baseRosterRevision: number;
    deactivateMissing: boolean;
  },
): {roster: ClassroomRoster; import: RosterImport; sync: RosterSyncResult} {
  const getRosterStmt = db.prepare(`
    SELECT * FROM classroom_rosters
    WHERE roster_id = ? AND owner_admin_id = ?
  `);
  const loadPreviewDrafts = (importId: string): PreviewRowDraft[] => {
    const rows = db
      .prepare(
        `SELECT * FROM roster_import_rows
         WHERE import_id = ?
         ORDER BY row_number ASC, row_id ASC`,
      )
      .all(importId) as ImportPreviewRow[];
    return rows.map(row => ({
      rowNumber: row.row_number,
      category: row.category as RosterImportPreviewCategory,
      studentId: row.student_id,
      proposed: JSON.parse(row.proposed_json) as Record<string, unknown>,
      issues: JSON.parse(row.issues_json) as PreviewRowDraft["issues"],
    }));
  };

  const row = getRosterStmt.get(input.rosterId, input.ownerAdminId) as
    | RosterRow
    | undefined;
  if (!row) {
    throw new RosterServiceError("ROSTER_NOT_FOUND", "Roster not found");
  }
  const roster = rowToRoster(row);

  const importRow = db
    .prepare(
      `SELECT * FROM roster_imports
       WHERE import_id = ? AND roster_id = ?`,
    )
    .get(input.importId, input.rosterId) as ImportRow | undefined;
  if (!importRow) {
    throw new RosterServiceError("IMPORT_NOT_FOUND", "Import not found");
  }
  const importRecord = rowToImport(importRow);
  if (importRecord.status !== "preview_ready") {
    throw new RosterServiceError(
      "IMPORT_NOT_APPLICABLE",
      "Import is not ready to apply",
    );
  }
  if (
    importRecord.previewHash !== input.previewHash ||
    importRecord.baseRosterRevision !== input.baseRosterRevision
  ) {
    throw new RosterServiceError(
      "STALE_PREVIEW",
      "Preview hash or roster revision is stale",
    );
  }

  const drafts = loadPreviewDrafts(input.importId);
  const hashWithFlag = computePreviewHash({
    baseRosterRevision: input.baseRosterRevision,
    deactivateMissing: input.deactivateMissing,
    rows: drafts,
  });
  if (hashWithFlag !== input.previewHash) {
    throw new RosterServiceError(
      "STALE_PREVIEW",
      "deactivateMissing does not match import preview",
    );
  }
  if (input.baseRosterRevision !== roster.rosterRevision) {
    throw new RosterServiceError(
      "STALE_PREVIEW",
      "Roster revision changed since preview",
    );
  }
  if (hasBlockingPreviewRows(drafts)) {
    markRosterSyncRequired(db, input.rosterId, input.ownerAdminId, "BLOCKING_PREVIEW");
    throw new RosterServiceError(
      "BLOCKING_PREVIEW",
      "Sheet sync preview contains blocking rows",
    );
  }

  const ts = nowIso();
  try {
    const tx = db.transaction(() => {
      const nextRoster = applyDraftsToRoster({
        db,
        rosterId: input.rosterId,
        ownerAdminId: input.ownerAdminId,
        baseRosterRevision: input.baseRosterRevision,
        drafts,
        audit: {source: "sheet_sync"},
        syncStatus: "active",
      });
      db.prepare(
        `UPDATE roster_imports SET
          status = 'applied', applied_at = ?, updated_at = ?
         WHERE import_id = ?`,
      ).run(ts, ts, input.importId);
      return nextRoster;
    });
    const nextRoster = tx();
    const nextImport = rowToImport(
      db
        .prepare(`SELECT * FROM roster_imports WHERE import_id = ?`)
        .get(input.importId) as ImportRow,
    );
    return {
      roster: nextRoster,
      import: nextImport,
      sync: {
        rosterId: nextRoster.rosterId,
        rosterRevision: nextRoster.rosterRevision,
        syncStatus: nextRoster.syncStatus,
        syncedAt: nextRoster.updatedAt,
      },
    };
  } catch (error) {
    if (
      error instanceof RosterServiceError &&
      error.code === "REVISION_CONFLICT"
    ) {
      markRosterSyncRequired(db, input.rosterId, input.ownerAdminId, error.code);
    }
    throw error;
  }
}
