/** Basic HTTP request limits for the R1 persistence slice. */
export const MAX_BODY_BYTES = 2 * 1024 * 1024; // 2 MiB
export const MAX_TITLE_LENGTH = 200;
export const MAX_TRANSACTION_ID_LENGTH = 128;
export const MAX_PROJECT_ID_LENGTH = 64;
export const MAX_SNAPSHOT_ID_LENGTH = 64;
export const MAX_REVISION = Number.MAX_SAFE_INTEGER;
