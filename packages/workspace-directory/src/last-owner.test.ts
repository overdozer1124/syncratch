import {describe, expect, it} from "vitest";
import {DirectoryError} from "./errors.js";
import {assertCanEndWorkspaceOwnerMembership} from "./last-owner.js";
import type {WorkspaceMembership} from "./models.js";

const ownerMembership = {
  id: "mem-owner",
  workspaceId: "ws-1",
  accountId: "account-1",
  role: "owner",
  status: "active",
  startedAt: "2026-07-18T00:00:00.000Z",
  endedAt: null,
} as WorkspaceMembership;

const memberMembership = {
  ...ownerMembership,
  id: "mem-member",
  role: "member",
} as WorkspaceMembership;

const endedOwnerMembership = {
  ...ownerMembership,
  id: "mem-ended-owner",
  status: "ended",
  endedAt: "2026-07-18T01:00:00.000Z",
} as WorkspaceMembership;

describe("assertCanEndWorkspaceOwnerMembership", () => {
  it("throws DIRECTORY_LAST_OWNER when ending the sole active owner", () => {
    expect(() =>
      assertCanEndWorkspaceOwnerMembership({
        membership: ownerMembership,
        activeOwnerCountInWorkspace: 1,
      }),
    ).toThrow(
      expect.objectContaining({
        name: "DirectoryError",
        code: "DIRECTORY_LAST_OWNER",
      }),
    );
    expect(() =>
      assertCanEndWorkspaceOwnerMembership({
        membership: ownerMembership,
        activeOwnerCountInWorkspace: 1,
      }),
    ).toThrow(DirectoryError);
  });

  it("allows ending an owner when another active owner remains", () => {
    expect(() =>
      assertCanEndWorkspaceOwnerMembership({
        membership: ownerMembership,
        activeOwnerCountInWorkspace: 2,
      }),
    ).not.toThrow();
  });

  it("allows ending non-owner or already-ended memberships", () => {
    expect(() =>
      assertCanEndWorkspaceOwnerMembership({
        membership: memberMembership,
        activeOwnerCountInWorkspace: 1,
      }),
    ).not.toThrow();
    expect(() =>
      assertCanEndWorkspaceOwnerMembership({
        membership: endedOwnerMembership,
        activeOwnerCountInWorkspace: 0,
      }),
    ).not.toThrow();
  });
});
