export type DirectoryErrorCode =
  | "DIRECTORY_NOT_FOUND"
  | "DIRECTORY_REVISION_CONFLICT"
  | "DIRECTORY_CONFLICT"
  | "DIRECTORY_INVALID"
  | "DIRECTORY_LAST_OWNER";

export class DirectoryError extends Error {
  readonly code: DirectoryErrorCode;
  constructor(code: DirectoryErrorCode, message: string) {
    super(message);
    this.name = "DirectoryError";
    this.code = code;
  }
}
