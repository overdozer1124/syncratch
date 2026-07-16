import type { AssetRepository } from "@blocksync/project-store-sqlite";

export function reconcileExpiredReservations(
  assetRepo: AssetRepository,
  now: () => Date = () => new Date(),
): { global: number; orgQuota: number; leases: number } {
  return assetRepo.deleteExpiredReservations(now().toISOString());
}
