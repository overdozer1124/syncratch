import {computeMigrationChecksum} from "../checksum.js";

export const r1LegacyOrganizationUserBackfillName =
  "r1-legacy-organization-user-backfill";

export const r1LegacyOrganizationUserBackfillChecksumSource = [
  "version=5",
  "name=r1-legacy-organization-user-backfill",
  "prepare:verified-vacuum-backup-v1",
  "validate:legacy-backfill-source-v1",
  "identity:uuidv5-5382ca4a-3efd-5013-bbff-25dc72876ebf",
  "insert:workspaces,user_accounts,people,person_account_links",
  "insert:workspace_memberships,workspace_directory_revisions,role_assignments",
  "update:sessions-revoke-unrevoked",
  "guard:locked-legacy-digest",
].join("\n");

export const r1LegacyOrganizationUserBackfillChecksum =
  computeMigrationChecksum(r1LegacyOrganizationUserBackfillChecksumSource);
