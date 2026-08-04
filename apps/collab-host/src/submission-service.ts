/**
 * Classroom submission persistence and Drive upload orchestration (PR 7).
 */
import {createHash} from "node:crypto";
import type Database from "better-sqlite3";
import {
  createOpaqueId,
  type SubmissionDetail,
  type SubmissionListItem,
} from "@blocksync/classroom-access";
import type {ResolvedGrantContext} from "./student-auth.js";
import {resolveStudentIdentitySession} from "./student-auth.js";
import {
  sanitizeSb3FileName,
  SubmissionDriveError,
  uploadSb3ToTeacherFolder,
  downloadSb3FromDrive,
  type SubmissionDriveEnvironment,
} from "./submission-drive.js";

export const DEFAULT_SUBMISSION_MAX_BYTES = 5 * 1024 * 1024;

export function readSubmissionMaxBytes(
  env: NodeJS.ProcessEnv = process.env,
): number {
  const raw = env.SYNCRATCH_SUBMISSION_MAX_BYTES?.trim();
  if (!raw) return DEFAULT_SUBMISSION_MAX_BYTES;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return DEFAULT_SUBMISSION_MAX_BYTES;
  }
  return Math.floor(parsed);
}

export class SubmissionServiceError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "SubmissionServiceError";
  }
}

interface PolicySubmissionRow {
  policy_id: string;
  owner_admin_id: string;
  status: string;
  submission_enabled: number;
  submission_drive_folder_id: string | null;
  roster_id: string | null;
  student_auth_required: number;
}

interface SubmissionRow {
  submission_id: string;
  policy_id: string;
  student_id: string;
  student_account_id: string;
  drive_file_id: string | null;
  content_sha256: string;
  size_bytes: number;
  project_title: string;
  status: string;
  is_resubmission: number;
  idempotency_key: string;
  submitted_at: string;
}

interface StudentJoinRow {
  student_code: string;
  display_name: string;
  attendance_number: string | null;
}

function nowIso(now = Date.now()): string {
  return new Date(now).toISOString();
}

function sha256Hex(bytes: Buffer): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function rowToListItem(
  row: SubmissionRow,
  student: StudentJoinRow,
): SubmissionListItem {
  return {
    submissionId: row.submission_id,
    policyId: row.policy_id,
    studentId: row.student_id,
    studentCode: student.student_code,
    displayName: student.display_name,
    attendanceNumber: student.attendance_number,
    projectTitle: row.project_title,
    submittedAt: row.submitted_at,
    isResubmission: Boolean(row.is_resubmission),
    sizeBytes: row.size_bytes,
    status: row.status === "failed" ? "failed" : "submitted",
  };
}

function rowToDetail(row: SubmissionRow, student: StudentJoinRow): SubmissionDetail {
  return {
    ...rowToListItem(row, student),
    contentSha256: row.content_sha256,
    driveFileId: row.drive_file_id,
  };
}

export interface UploadSubmissionInput {
  grant: ResolvedGrantContext;
  identityToken: string;
  signingSecret: string;
  idempotencyKey: string;
  projectTitle: string;
  bytes: Buffer;
  nowMs?: number;
}

export interface UploadSubmissionResult {
  submission: SubmissionDetail;
  reused: boolean;
}

export function createSubmissionService(
  db: Database.Database,
  driveEnv: SubmissionDriveEnvironment | null,
  maxBytes = readSubmissionMaxBytes(),
) {
  const getPolicy = db.prepare(`
    SELECT policy_id, owner_admin_id, status, submission_enabled,
           submission_drive_folder_id, roster_id, student_auth_required
    FROM classroom_policies
    WHERE policy_id = ?
  `);

  const getExistingByIdempotency = db.prepare(`
    SELECT s.*, cs.student_code, cs.display_name, cs.attendance_number
    FROM classroom_submissions s
    JOIN classroom_students cs ON cs.student_id = s.student_id
    WHERE s.student_account_id = ? AND s.idempotency_key = ?
  `);

  const countPriorSubmissions = db.prepare(`
    SELECT COUNT(*) AS count
    FROM classroom_submissions
    WHERE policy_id = ? AND student_id = ? AND status = 'submitted'
  `);

  const getAccountId = db.prepare(`
    SELECT account_id FROM student_accounts WHERE student_id = ?
  `);

  return {
    uploadStudentSubmission(
      input: UploadSubmissionInput,
    ): Promise<UploadSubmissionResult> {
      return uploadStudentSubmissionImpl(
        db,
        driveEnv,
        maxBytes,
        {
          getPolicy,
          getExistingByIdempotency,
          countPriorSubmissions,
          getAccountId,
        },
        input,
      );
    },

    listPolicySubmissions(
      policyId: string,
      ownerAdminId: string,
    ): SubmissionListItem[] {
      const policy = db
        .prepare(
          `SELECT policy_id FROM classroom_policies
           WHERE policy_id = ? AND owner_admin_id = ?`,
        )
        .get(policyId, ownerAdminId) as {policy_id: string} | undefined;
      if (!policy) return [];

      const rows = db
        .prepare(
          `SELECT s.*, cs.student_code, cs.display_name, cs.attendance_number
           FROM classroom_submissions s
           JOIN classroom_students cs ON cs.student_id = s.student_id
           WHERE s.policy_id = ?
           ORDER BY s.submitted_at DESC`,
        )
        .all(policyId) as Array<SubmissionRow & StudentJoinRow>;

      return rows.map(row =>
        rowToListItem(row, {
          student_code: row.student_code,
          display_name: row.display_name,
          attendance_number: row.attendance_number,
        }),
      );
    },

    getSubmissionDetail(
      submissionId: string,
      ownerAdminId: string,
    ): SubmissionDetail | null {
      const row = db
        .prepare(
          `SELECT s.*, cs.student_code, cs.display_name, cs.attendance_number,
                  p.owner_admin_id
           FROM classroom_submissions s
           JOIN classroom_students cs ON cs.student_id = s.student_id
           JOIN classroom_policies p ON p.policy_id = s.policy_id
           WHERE s.submission_id = ? AND p.owner_admin_id = ?`,
        )
        .get(submissionId, ownerAdminId) as
        | (SubmissionRow & StudentJoinRow & {owner_admin_id: string})
        | undefined;
      if (!row) return null;
      return rowToDetail(row, {
        student_code: row.student_code,
        display_name: row.display_name,
        attendance_number: row.attendance_number,
      });
    },

    async streamSubmissionContent(
      submissionId: string,
      ownerAdminId: string,
    ): Promise<{bytes: Buffer; fileName: string} | null> {
      if (!driveEnv) return null;
      const row = db
        .prepare(
          `SELECT s.drive_file_id, s.project_title, cs.student_code, p.owner_admin_id
           FROM classroom_submissions s
           JOIN classroom_students cs ON cs.student_id = s.student_id
           JOIN classroom_policies p ON p.policy_id = s.policy_id
           WHERE s.submission_id = ? AND p.owner_admin_id = ?`,
        )
        .get(submissionId, ownerAdminId) as
        | {
            drive_file_id: string | null;
            project_title: string;
            student_code: string;
            owner_admin_id: string;
          }
        | undefined;
      if (!row?.drive_file_id) return null;
      const bytes = await downloadSb3FromDrive(driveEnv, {
        ownerAdminId: row.owner_admin_id,
        driveFileId: row.drive_file_id,
      });
      return {
        bytes,
        fileName: sanitizeSb3FileName(row.project_title, row.student_code),
      };
    },
  };
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function isSqliteUniqueConstraint(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as {code?: string}).code === "SQLITE_CONSTRAINT_UNIQUE"
  );
}

async function waitForSubmittedByIdempotency(
  getExistingByIdempotency: Database.Statement,
  accountId: string,
  idempotencyKey: string,
  deadlineMs: number,
): Promise<(SubmissionRow & StudentJoinRow) | null> {
  while (Date.now() < deadlineMs) {
    const row = getExistingByIdempotency.get(accountId, idempotencyKey) as
      | (SubmissionRow & StudentJoinRow)
      | undefined;
    if (!row) return null;
    if (row.status === "submitted") return row;
    if (row.status === "failed") return null;
    await sleep(10);
  }
  return null;
}

async function uploadStudentSubmissionImpl(
  db: Database.Database,
  driveEnv: SubmissionDriveEnvironment | null,
  maxBytes: number,
  stmts: {
    getPolicy: Database.Statement;
    getExistingByIdempotency: Database.Statement;
    countPriorSubmissions: Database.Statement;
    getAccountId: Database.Statement;
  },
  input: UploadSubmissionInput,
): Promise<UploadSubmissionResult> {
  const nowMs = input.nowMs ?? Date.now();
  const identity = resolveStudentIdentitySession(db, {
    grantId: input.grant.grantId,
    identityToken: input.identityToken,
    signingSecret: input.signingSecret,
    nowMs,
  });
  if (!identity) {
    throw new SubmissionServiceError("IDENTITY_REQUIRED", "Identity required");
  }

  const policy = stmts.getPolicy.get(input.grant.policyId) as
    | PolicySubmissionRow
    | undefined;
  if (!policy || policy.status !== "active") {
    throw new SubmissionServiceError("POLICY_NOT_FOUND", "Policy not found");
  }
  if (!policy.submission_enabled) {
    throw new SubmissionServiceError(
      "SUBMISSION_DISABLED",
      "Submission is disabled for this classroom",
    );
  }
  if (!policy.submission_drive_folder_id) {
    throw new SubmissionServiceError(
      "SUBMISSION_NOT_CONFIGURED",
      "Submission folder is not configured",
    );
  }

  const idempotencyKey = input.idempotencyKey.trim();
  if (!idempotencyKey || idempotencyKey.length > 128) {
    throw new SubmissionServiceError(
      "BAD_REQUEST",
      "idempotencyKey is required",
    );
  }

  const account = stmts.getAccountId.get(identity.studentId) as
    | {account_id: string}
    | undefined;
  if (!account) {
    throw new SubmissionServiceError("IDENTITY_REQUIRED", "Identity required");
  }

  if (input.bytes.length > maxBytes) {
    throw new SubmissionServiceError(
      "PAYLOAD_TOO_LARGE",
      `提出ファイルは ${Math.floor(maxBytes / (1024 * 1024))} MiB 以下にしてください。`,
    );
  }

  const projectTitle =
    typeof input.projectTitle === "string" && input.projectTitle.trim()
      ? input.projectTitle.trim().slice(0, 120)
      : "提出作品";

  if (!driveEnv) {
    throw new SubmissionServiceError(
      "NOT_CONFIGURED",
      "Teacher Drive submission is not configured",
    );
  }

  const contentSha256 = sha256Hex(input.bytes);
  const prior = stmts.countPriorSubmissions.get(
    input.grant.policyId,
    identity.studentId,
  ) as {count: number};
  const isResubmission = prior.count > 0;
  const ts = nowIso(nowMs);
  const fileName = sanitizeSb3FileName(projectTitle, identity.loginName);

  type ReserveResult =
    | {kind: "existing"; row: SubmissionRow & StudentJoinRow}
    | {kind: "reserved"; submissionId: string};

  const reserve = db.transaction((): ReserveResult => {
    const row = stmts.getExistingByIdempotency.get(
      account.account_id,
      idempotencyKey,
    ) as (SubmissionRow & StudentJoinRow) | undefined;
    if (row?.status === "submitted" || row?.status === "pending") {
      return {kind: "existing", row};
    }
    const submissionId = createOpaqueId();
    try {
      db.prepare(
        `INSERT INTO classroom_submissions (
          submission_id, policy_id, student_id, student_account_id,
          drive_file_id, content_sha256, size_bytes, project_title,
          status, is_resubmission, idempotency_key,
          submitted_at, created_at, updated_at
        ) VALUES (?, ?, ?, ?, NULL, ?, ?, ?, 'pending', ?, ?, ?, ?, ?)`,
      ).run(
        submissionId,
        input.grant.policyId,
        identity.studentId,
        account.account_id,
        contentSha256,
        input.bytes.length,
        projectTitle,
        isResubmission ? 1 : 0,
        idempotencyKey,
        ts,
        ts,
        ts,
      );
      return {kind: "reserved", submissionId};
    } catch (error) {
      if (isSqliteUniqueConstraint(error)) {
        const raced = stmts.getExistingByIdempotency.get(
          account.account_id,
          idempotencyKey,
        ) as (SubmissionRow & StudentJoinRow) | undefined;
        if (raced) return {kind: "existing", row: raced};
      }
      throw error;
    }
  })();

  if (reserve.kind === "existing") {
    if (reserve.row.status === "pending") {
      const submitted = await waitForSubmittedByIdempotency(
        stmts.getExistingByIdempotency,
        account.account_id,
        idempotencyKey,
        nowMs + 10_000,
      );
      if (!submitted) {
        throw new SubmissionServiceError(
          "CONFLICT",
          "Submission is still in progress",
        );
      }
      return {
        submission: rowToDetail(submitted, {
          student_code: submitted.student_code,
          display_name: submitted.display_name,
          attendance_number: submitted.attendance_number,
        }),
        reused: true,
      };
    }
    return {
      submission: rowToDetail(reserve.row, {
        student_code: reserve.row.student_code,
        display_name: reserve.row.display_name,
        attendance_number: reserve.row.attendance_number,
      }),
      reused: true,
    };
  }

  const submissionId = reserve.submissionId;
  let driveFileId: string | null = null;
  try {
    const uploaded = await uploadSb3ToTeacherFolder(driveEnv, {
      ownerAdminId: policy.owner_admin_id,
      folderId: policy.submission_drive_folder_id,
      fileName,
      bytes: input.bytes,
    });
    driveFileId = uploaded.driveFileId;
  } catch (error) {
    db.prepare(
      `UPDATE classroom_submissions
       SET status = 'failed', updated_at = ?
       WHERE submission_id = ?`,
    ).run(ts, submissionId);
    if (error instanceof SubmissionDriveError) {
      throw new SubmissionServiceError(error.code, error.message);
    }
    throw error;
  }

  db.prepare(
    `UPDATE classroom_submissions
     SET drive_file_id = ?, status = 'submitted', updated_at = ?
     WHERE submission_id = ?`,
  ).run(driveFileId, ts, submissionId);

  db.prepare(
    `INSERT INTO classroom_audit_events (
      event_id, owner_admin_id, roster_id, student_id,
      event_type, payload_json, created_at
    ) VALUES (?, ?, ?, ?, 'student.submission.uploaded', ?, ?)`,
  ).run(
    createOpaqueId(),
    policy.owner_admin_id,
    input.grant.rosterId,
    identity.studentId,
    JSON.stringify({
      submissionId,
      sizeBytes: input.bytes.length,
      isResubmission,
    }),
    ts,
  );

  const student = db
    .prepare(
      `SELECT student_code, display_name, attendance_number
       FROM classroom_students WHERE student_id = ?`,
    )
    .get(identity.studentId) as StudentJoinRow;

  return {
    submission: rowToDetail(
      {
        submission_id: submissionId,
        policy_id: input.grant.policyId,
        student_id: identity.studentId,
        student_account_id: account.account_id,
        drive_file_id: driveFileId,
        content_sha256: contentSha256,
        size_bytes: input.bytes.length,
        project_title: projectTitle,
        status: "submitted",
        is_resubmission: isResubmission ? 1 : 0,
        idempotency_key: idempotencyKey,
        submitted_at: ts,
      },
      student,
    ),
    reused: false,
  };
}

export type SubmissionService = ReturnType<typeof createSubmissionService>;
