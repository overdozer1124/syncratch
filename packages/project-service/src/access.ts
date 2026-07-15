import type { AuthPrincipal } from "@blocksync/auth-context";
import { ForbiddenError, NotFoundError } from "./errors.js";
import type {
  ProjectAccessPolicy,
  ProjectAction,
  ProjectRepositoryTx,
} from "./ports.js";

function roleAllows(
  role: "owner" | "member" | "admin",
  action: ProjectAction,
): boolean {
  if (action === "read") return true;
  if (action === "write") return role === "owner" || role === "member" || role === "admin";
  return role === "owner" || role === "admin";
}

export class DurableProjectAccessPolicy implements ProjectAccessPolicy {
  assertCan(
    principal: AuthPrincipal,
    projectId: string,
    action: ProjectAction,
    tx: ProjectRepositoryTx,
  ): void {
    const membership = tx.getMembership(projectId, principal.userId);
    if (!membership) {
      // Existence hiding for non-members (including same-org non-members).
      throw new NotFoundError();
    }
    if (membership.organizationId !== principal.organizationId) {
      throw new NotFoundError();
    }
    if (!roleAllows(membership.role, action)) {
      throw new ForbiddenError();
    }
  }
}
