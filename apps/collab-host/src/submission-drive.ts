/**
 * Google Drive upload/download for teacher-submitted SB3 files (drive.file scope).
 */
import {randomBytes} from "node:crypto";
import type {AdminGoogleCredentialRecord} from "./admin-google-credential-store.js";
import type {AdminGoogleOAuthConfig} from "./admin-google-oauth.js";
import {
  ensureAdminAccessToken,
  type RosterSheetSyncEnvironment,
} from "./roster-sheet-sync.js";

export class SubmissionDriveError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "SubmissionDriveError";
  }
}

export type SubmissionDriveEnvironment = RosterSheetSyncEnvironment;

const DEFAULT_PROJECT_TITLE = "提出作品";

/** UTC wall-clock parts for stable Drive filenames (YYYYMMDD-HHmmss). */
export function formatSubmissionTimestamp(submittedAtMs: number): string {
  const d = new Date(submittedAtMs);
  const pad = (n: number) => String(n).padStart(2, "0");
  return (
    `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}-` +
    `${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())}`
  );
}

export function sanitizeSubmissionFileNamePart(value: string, maxLen: number): string {
  const trimmed = value.trim();
  if (!trimmed) return "";
  const safe = trimmed
    .replace(/[\u0000-\u001f\u007f]+/g, "")
    .replace(/[\\/:*?"<>|]+/g, "_")
    .replace(/\s+/g, " ")
    .replace(/[^\w\u3040-\u30ff\u3400-\u9fff .-]+/g, "_")
    .replace(/_+/g, "_")
    .replace(/^[\s._-]+|[\s._-]+$/g, "");
  return safe.slice(0, maxLen) || "";
}

export interface BuildSubmissionSb3FileNameInput {
  studentCode: string;
  displayName: string;
  projectTitle: string;
  submittedAtMs: number;
}

/**
 * Drive object name: {student_code}_{display_name}_{project_title}_{timestamp}.sb3
 * Leading student_code keeps folder listings in roster ID order (e.g. 261101).
 */
export function buildSubmissionSb3FileName(
  input: BuildSubmissionSb3FileNameInput,
): string {
  const studentCode =
    sanitizeSubmissionFileNamePart(input.studentCode, 16) || "student";
  const displayName =
    sanitizeSubmissionFileNamePart(input.displayName, 40) || "student";
  const titleRaw = input.projectTitle.trim().replace(/\.sb3$/i, "");
  const projectTitle =
    sanitizeSubmissionFileNamePart(titleRaw, 60) || DEFAULT_PROJECT_TITLE;
  const timestamp = formatSubmissionTimestamp(input.submittedAtMs);
  return `${studentCode}_${displayName}_${projectTitle}_${timestamp}.sb3`;
}

export async function uploadSb3ToTeacherFolder(
  env: SubmissionDriveEnvironment,
  input: {
    ownerAdminId: string;
    folderId: string;
    fileName: string;
    bytes: Buffer;
  },
): Promise<{driveFileId: string}> {
  const {accessToken} = await ensureAdminAccessToken(env, input.ownerAdminId);
  const fetchImpl = env.fetch ?? fetch;
  const boundary = `syncratch_${randomBytes(12).toString("hex")}`;
  const metadata = JSON.stringify({
    name: input.fileName,
    parents: [input.folderId],
    mimeType: "application/x.scratch.sb3",
  });
  const prefix = Buffer.from(
    `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${metadata}\r\n--${boundary}\r\nContent-Type: application/x.scratch.sb3\r\n\r\n`,
    "utf8",
  );
  const suffix = Buffer.from(`\r\n--${boundary}--`, "utf8");
  const body = Buffer.concat([prefix, input.bytes, suffix]);

  const response = await fetchImpl(
    "https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id",
    {
      method: "POST",
      headers: {
        authorization: `Bearer ${accessToken}`,
        "content-type": `multipart/related; boundary=${boundary}`,
      },
      body,
    },
  );
  const json = (await response.json()) as {id?: string; error?: {message?: string}};
  if (!response.ok || !json.id) {
    throw new SubmissionDriveError(
      response.status === 404 ? "FOLDER_INACCESSIBLE" : "DRIVE_UPLOAD_FAILED",
      json.error?.message || "Drive upload failed",
    );
  }
  return {driveFileId: json.id};
}

export async function downloadSb3FromDrive(
  env: SubmissionDriveEnvironment,
  input: {
    ownerAdminId: string;
    driveFileId: string;
  },
): Promise<Buffer> {
  const {accessToken} = await ensureAdminAccessToken(env, input.ownerAdminId);
  const fetchImpl = env.fetch ?? fetch;
  const response = await fetchImpl(
    `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(input.driveFileId)}?alt=media`,
    {
      headers: {authorization: `Bearer ${accessToken}`},
    },
  );
  if (!response.ok) {
    throw new SubmissionDriveError(
      response.status === 404 ? "FILE_INACCESSIBLE" : "DRIVE_DOWNLOAD_FAILED",
      "Drive download failed",
    );
  }
  const arrayBuffer = await response.arrayBuffer();
  return Buffer.from(arrayBuffer);
}

export type {AdminGoogleCredentialRecord, AdminGoogleOAuthConfig};
