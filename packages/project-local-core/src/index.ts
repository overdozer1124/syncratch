import {
  validateProject,
  type ProjectDocument,
} from "@blocksync/project-schema";

export const LOCAL_PROJECT_FORMAT = "blocksync.local-project/v1" as const;

export type LocalProjectSaveState =
  | "clean"
  | "dirty"
  | "saving"
  | "error"
  | "conflict";

export interface LocalProjectAssetRecord {
  md5ext: string;
  bytes: Uint8Array;
}

export interface LocalProjectRecord {
  format: typeof LOCAL_PROJECT_FORMAT;
  localProjectId: string;
  title: string;
  revision: number;
  updatedAt: string;
  document: ProjectDocument;
  assets: LocalProjectAssetRecord[];
  saveState: LocalProjectSaveState;
  driveFileId?: string;
}

export interface LocalProjectValidationIssue {
  code: string;
  message: string;
  path?: string;
}

export type LocalProjectValidationResult =
  | {ok: true; value: LocalProjectRecord}
  | {ok: false; issues: readonly LocalProjectValidationIssue[]};

const TOP_LEVEL_FIELDS = new Set([
  "format",
  "localProjectId",
  "title",
  "revision",
  "updatedAt",
  "document",
  "assets",
  "saveState",
  "driveFileId",
]);

const SAVE_STATES = new Set<LocalProjectSaveState>([
  "clean",
  "dirty",
  "saving",
  "error",
  "conflict",
]);

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function isUtcDateTime(value: unknown): value is string {
  if (
    typeof value !== "string" ||
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)
  ) {
    return false;
  }
  const time = Date.parse(value);
  return Number.isFinite(time) && new Date(time).toISOString() === value;
}

function validationIssue(
  code: string,
  message: string,
  path?: string,
): LocalProjectValidationIssue {
  return path === undefined ? {code, message} : {code, message, path};
}

export function validateLocalProjectRecord(
  candidate: unknown,
): LocalProjectValidationResult {
  if (!isPlainRecord(candidate)) {
    return {
      ok: false,
      issues: [
        validationIssue(
          "INVALID_LOCAL_PROJECT",
          "local project record must be a plain object",
        ),
      ],
    };
  }

  const issues: LocalProjectValidationIssue[] = [];
  for (const key of Object.keys(candidate)) {
    if (!TOP_LEVEL_FIELDS.has(key)) {
      issues.push(
        validationIssue(
          "UNKNOWN_LOCAL_PROJECT_FIELD",
          `unknown local project field ${key}`,
          key,
        ),
      );
    }
  }

  if (candidate.format !== LOCAL_PROJECT_FORMAT) {
    issues.push(
      validationIssue(
        "INVALID_LOCAL_PROJECT_FORMAT",
        `format must be ${LOCAL_PROJECT_FORMAT}`,
        "format",
      ),
    );
  }
  if (
    typeof candidate.localProjectId !== "string" ||
    candidate.localProjectId.length === 0
  ) {
    issues.push(
      validationIssue(
        "INVALID_LOCAL_PROJECT_ID",
        "localProjectId must be a non-empty string",
        "localProjectId",
      ),
    );
  }
  if (typeof candidate.title !== "string") {
    issues.push(
      validationIssue(
        "INVALID_LOCAL_PROJECT_TITLE",
        "title must be a string",
        "title",
      ),
    );
  }
  if (
    !Number.isSafeInteger(candidate.revision) ||
    (candidate.revision as number) < 0
  ) {
    issues.push(
      validationIssue(
        "INVALID_LOCAL_PROJECT_REVISION",
        "revision must be a non-negative safe integer",
        "revision",
      ),
    );
  }
  if (!isUtcDateTime(candidate.updatedAt)) {
    issues.push(
      validationIssue(
        "INVALID_LOCAL_PROJECT_UPDATED_AT",
        "updatedAt must be a UTC date-time with millisecond precision",
        "updatedAt",
      ),
    );
  }
  if (
    typeof candidate.saveState !== "string" ||
    !SAVE_STATES.has(candidate.saveState as LocalProjectSaveState)
  ) {
    issues.push(
      validationIssue(
        "INVALID_LOCAL_PROJECT_SAVE_STATE",
        "saveState is not recognized",
        "saveState",
      ),
    );
  }
  if (
    "driveFileId" in candidate &&
    (typeof candidate.driveFileId !== "string" ||
      candidate.driveFileId.length === 0)
  ) {
    issues.push(
      validationIssue(
        "INVALID_DRIVE_FILE_ID",
        "driveFileId must be a non-empty string when present",
        "driveFileId",
      ),
    );
  }

  if (!Array.isArray(candidate.assets)) {
    issues.push(
      validationIssue(
        "INVALID_LOCAL_PROJECT_ASSETS",
        "assets must be an array",
        "assets",
      ),
    );
  } else {
    const seen = new Set<string>();
    candidate.assets.forEach((asset, index) => {
      const path = `assets[${index}]`;
      if (!isPlainRecord(asset)) {
        issues.push(
          validationIssue(
            "INVALID_LOCAL_PROJECT_ASSET",
            "asset must be a plain object",
            path,
          ),
        );
        return;
      }
      for (const key of Object.keys(asset)) {
        if (key !== "md5ext" && key !== "bytes") {
          issues.push(
            validationIssue(
              "UNKNOWN_LOCAL_PROJECT_ASSET_FIELD",
              `unknown asset field ${key}`,
              `${path}.${key}`,
            ),
          );
        }
      }
      if (typeof asset.md5ext !== "string" || asset.md5ext.length === 0) {
        issues.push(
          validationIssue(
            "INVALID_LOCAL_PROJECT_ASSET_KEY",
            "asset md5ext must be a non-empty string",
            `${path}.md5ext`,
          ),
        );
      } else if (seen.has(asset.md5ext)) {
        issues.push(
          validationIssue(
            "DUPLICATE_LOCAL_PROJECT_ASSET",
            `duplicate asset ${asset.md5ext}`,
            `${path}.md5ext`,
          ),
        );
      } else {
        seen.add(asset.md5ext);
      }
      if (!(asset.bytes instanceof Uint8Array)) {
        issues.push(
          validationIssue(
            "INVALID_LOCAL_PROJECT_ASSET_BYTES",
            "asset bytes must be a Uint8Array",
            `${path}.bytes`,
          ),
        );
      }
    });
  }

  const documentResult = validateProject(
    candidate.document as ProjectDocument,
  );
  if (!documentResult.ok) {
    for (const issue of documentResult.issues) {
      issues.push(
        validationIssue(
          issue.code,
          issue.message,
          issue.path ? `document.${issue.path}` : "document",
        ),
      );
    }
  }

  if (issues.length > 0) {
    return {ok: false, issues};
  }
  return {ok: true, value: candidate as unknown as LocalProjectRecord};
}
