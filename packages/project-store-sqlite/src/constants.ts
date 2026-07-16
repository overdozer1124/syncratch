/** R1 capacity constants (Design §4.6). */
export const ORG_QUOTA_BYTES = 536_870_912; // 512 MiB
export const GLOBAL_DISK_BYTES = 2_147_483_648; // 2 GiB
export const ASSET_MAX_BYTES = 10_485_760; // 10 MiB
export const IMPORT_SPOOL_CAP_BYTES = 33_554_432; // 32 MiB
export const IMPORT_HOLDING_BUDGET_BYTES = 33_554_432; // 32 MiB
export const WORKER_TEMP_BUDGET_BYTES = 67_108_864; // 64 MiB
export const INITIAL_GLOBAL_RESERVATION_BYTES =
  IMPORT_SPOOL_CAP_BYTES +
  IMPORT_HOLDING_BUDGET_BYTES +
  WORKER_TEMP_BUDGET_BYTES; // 128 MiB
export const RESERVATION_TTL_MS = 15 * 60 * 1000;

export const ASSET_DATA_FORMATS = [
  "svg",
  "png",
  "jpg",
  "bmp",
  "gif",
  "wav",
  "mp3",
] as const;

export type AssetDataFormat = (typeof ASSET_DATA_FORMATS)[number];
