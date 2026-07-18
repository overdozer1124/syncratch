import {describe, expect, it} from "vitest";
import {DirectoryError} from "./errors.js";
import type {
  WorkspaceDirectoryRepository,
  WorkspaceDirectoryRepositoryTx,
} from "./repository.js";

describe("directory repository port", () => {
  it("exposes DirectoryError codes", () => {
    const err = new DirectoryError("DIRECTORY_REVISION_CONFLICT", "stale");
    expect(err).toBeInstanceOf(Error);
    expect(err.code).toBe("DIRECTORY_REVISION_CONFLICT");
    expect(err.name).toBe("DirectoryError");
  });

  it("types WorkspaceDirectoryRepository withTransaction", () => {
    const _typeCheck: WorkspaceDirectoryRepository = {
      withTransaction: (fn) => fn({} as never),
    };
    expect(typeof _typeCheck.withTransaction).toBe("function");
  });

  it("requires workspaceId on endMembership and endWorkspaceRole inputs", () => {
    type EndMembershipInput = Parameters<
      WorkspaceDirectoryRepositoryTx["endMembership"]
    >[0];
    type EndWorkspaceRoleInput = Parameters<
      WorkspaceDirectoryRepositoryTx["endWorkspaceRole"]
    >[0];

    const _endMembership: EndMembershipInput = {
      workspaceId: "ws-1",
      expectedRevision: 0,
      membershipId: "mem-1",
      endedAt: "2026-07-18T00:00:00.000Z",
    };
    const _endWorkspaceRole: EndWorkspaceRoleInput = {
      workspaceId: "ws-1",
      expectedRevision: 0,
      assignmentId: "role-1",
      endedAt: "2026-07-18T00:00:00.000Z",
    };

    expect(_endMembership.workspaceId).toBe("ws-1");
    expect(_endWorkspaceRole.workspaceId).toBe("ws-1");
  });
});
