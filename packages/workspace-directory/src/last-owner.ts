import {DirectoryError} from "./errors.js";
import type {WorkspaceMembership} from "./models.js";

export function assertCanEndWorkspaceOwnerMembership(input: {
  membership: WorkspaceMembership;
  activeOwnerCountInWorkspace: number;
}): void {
  const {membership, activeOwnerCountInWorkspace} = input;
  if (membership.role !== "owner" || membership.status !== "active") {
    return;
  }
  if (activeOwnerCountInWorkspace <= 1) {
    throw new DirectoryError(
      "DIRECTORY_LAST_OWNER",
      `cannot end the last active owner membership in workspace ${membership.workspaceId}`,
    );
  }
}
