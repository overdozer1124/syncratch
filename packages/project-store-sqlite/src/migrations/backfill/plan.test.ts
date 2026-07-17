import Database from "better-sqlite3";
import {describe, expect, it} from "vitest";
import {r1BaselineMigration} from "../0001-r1-baseline.js";
import {r1IdentityCoreMigration} from "../0002-r1-identity-core.js";
import {r1SchoolRosterMigration} from "../0003-r1-school-roster.js";
import {r1AccessImportAuditMigration} from "../0004-r1-access-import-audit.js";
import {SchemaMigrationError} from "../types.js";
import {
  type LegacyBackfillSource,
  readLegacyBackfillSource,
} from "./source.js";
import {computeLegacyBackfillPlan} from "./plan.js";
import {validateLegacyBackfillSource} from "./validate.js";

const APPLIED_AT = "2026-07-18T00:00:00.000Z";
const EARLY = "2026-07-16T00:00:00.000Z";
const LATE = "2026-07-17T00:00:00.000Z";

function validSource(): LegacyBackfillSource {
  return {
    organizations: [
      {
        id: "org-active",
        name: "  Active Workspace  ",
        status: "active",
        created_at: EARLY,
      },
      {
        id: "org-suspended",
        name: "Suspended Workspace",
        status: "suspended",
        created_at: EARLY,
      },
    ],
    users: [
      {
        id: "user-disabled",
        primary_organization_id: "org-active",
        display_name: "   ",
        email: " disabled@example.test ",
        status: "disabled",
        created_at: LATE,
        updated_at: LATE,
      },
      {
        id: "user-owner",
        primary_organization_id: "org-active",
        display_name: "  Owner Name  ",
        email: "owner@example.test",
        status: "active",
        created_at: LATE,
        updated_at: LATE,
      },
      {
        id: "user-suspended",
        primary_organization_id: "org-suspended",
        display_name: null,
        email: null,
        status: "active",
        created_at: LATE,
        updated_at: LATE,
      },
    ],
    memberships: [
      {
        organization_id: "org-active",
        user_id: "user-disabled",
        role: "member",
      },
      {
        organization_id: "org-active",
        user_id: "user-owner",
        role: "admin",
      },
      {
        organization_id: "org-suspended",
        user_id: "user-suspended",
        role: "member",
      },
    ],
    sessions: [
      {
        id_hash: "session-revoked",
        user_id: "user-owner",
        organization_id: "org-active",
        csrf_hash: "csrf-1",
        created_at: EARLY,
        expires_at: APPLIED_AT,
        revoked_at: LATE,
        last_seen_at: null,
      },
      {
        id_hash: "session-unrevoked",
        user_id: "user-owner",
        organization_id: "org-active",
        csrf_hash: "csrf-2",
        created_at: EARLY,
        expires_at: APPLIED_AT,
        revoked_at: null,
        last_seen_at: LATE,
      },
    ],
    projects: [
      {
        id: "project-1",
        organization_id: "org-active",
        owner_user_id: "user-owner",
        title: "Project",
        head_revision: 0,
        created_at: EARLY,
        updated_at: LATE,
      },
    ],
    projectMembers: [
      {project_id: "project-1", user_id: "user-disabled", role: "editor"},
      {project_id: "project-1", user_id: "user-owner", role: "owner"},
    ],
    targetRowCounts: {
      workspaces: 0,
      user_accounts: 0,
      people: 0,
      person_account_links: 0,
      workspace_memberships: 0,
      workspace_directory_revisions: 0,
      role_assignments: 0,
    },
  };
}

function cloneSource(): LegacyBackfillSource {
  return structuredClone(validSource());
}

function expectInvalid(source: LegacyBackfillSource): void {
  try {
    validateLegacyBackfillSource(source);
    throw new Error("expected validation failure");
  } catch (error) {
    expect(error).toBeInstanceOf(SchemaMigrationError);
    expect(error).toMatchObject({code: "SCHEMA_BACKFILL_INVALID"});
  }
}

describe("legacy backfill source validation", () => {
  it.each([
    ["blank organization id", (source: LegacyBackfillSource) => {
      (source.organizations[0] as {id: string}).id = " ";
    }],
    ["blank user id", (source: LegacyBackfillSource) => {
      (source.users[0] as {id: string}).id = "";
    }],
    ["blank membership organization id", (source: LegacyBackfillSource) => {
      (source.memberships[0] as {organization_id: string}).organization_id = " ";
    }],
    ["blank session id", (source: LegacyBackfillSource) => {
      (source.sessions[0] as {id_hash: string}).id_hash = " ";
    }],
    ["blank project id", (source: LegacyBackfillSource) => {
      (source.projects[0] as {id: string}).id = " ";
    }],
    ["blank project member user id", (source: LegacyBackfillSource) => {
      (source.projectMembers[0] as {user_id: string}).user_id = " ";
    }],
    ["blank organization name", (source: LegacyBackfillSource) => {
      (source.organizations[0] as {name: string}).name = " \t ";
    }],
    ["invalid organization status", (source: LegacyBackfillSource) => {
      (source.organizations[0] as {status: string}).status = "disabled";
    }],
    ["invalid user status", (source: LegacyBackfillSource) => {
      (source.users[0] as {status: string}).status = "suspended";
    }],
    ["invalid membership role", (source: LegacyBackfillSource) => {
      (source.memberships[0] as {role: string}).role = "owner";
    }],
    ["missing primary organization", (source: LegacyBackfillSource) => {
      (source.users[0] as {primary_organization_id: string})
        .primary_organization_id = "missing";
    }],
    ["missing primary membership", (source: LegacyBackfillSource) => {
      (source as {memberships: LegacyBackfillSource["memberships"]}).memberships =
        source.memberships.filter(row => row.user_id !== "user-disabled");
    }],
    ["membership missing organization", (source: LegacyBackfillSource) => {
      (source.memberships[0] as {organization_id: string}).organization_id =
        "missing";
    }],
    ["membership missing user", (source: LegacyBackfillSource) => {
      (source.memberships[0] as {user_id: string}).user_id = "missing";
    }],
    ["project missing organization", (source: LegacyBackfillSource) => {
      (source.projects[0] as {organization_id: string}).organization_id =
        "missing";
    }],
    ["project missing owner", (source: LegacyBackfillSource) => {
      (source.projects[0] as {owner_user_id: string}).owner_user_id = "missing";
    }],
    ["project owner outside organization", (source: LegacyBackfillSource) => {
      (source.projects[0] as {owner_user_id: string}).owner_user_id =
        "user-suspended";
    }],
    ["project member outside organization", (source: LegacyBackfillSource) => {
      (source.projectMembers[0] as {user_id: string}).user_id =
        "user-suspended";
    }],
    ["invalid project role", (source: LegacyBackfillSource) => {
      (source.projectMembers[0] as {role: string}).role = "admin";
    }],
    ["session missing membership", (source: LegacyBackfillSource) => {
      (source.sessions[0] as {organization_id: string}).organization_id =
        "org-suspended";
    }],
  ] as const)("rejects %s", (_name, mutate) => {
    const source = cloneSource();
    mutate(source);
    expectInvalid(source);
  });

  it("rejects deterministic target identity conflicts", () => {
    const source = cloneSource();
    (
      source as {
        sessions: LegacyBackfillSource["sessions"];
      }
    ).sessions = [...source.sessions, source.sessions[0]!];

    expectInvalid(source);
  });

  it.each([
    ["organization created_at", (source: LegacyBackfillSource) => {
      (source.organizations[0] as {created_at: string}).created_at =
        "2026-07-16T00:00:00Z";
    }],
    ["user updated_at", (source: LegacyBackfillSource) => {
      (source.users[0] as {updated_at: string}).updated_at =
        "2026-07-17T00:00:00+00:00";
    }],
    ["session last_seen_at", (source: LegacyBackfillSource) => {
      (source.sessions[0] as {last_seen_at: string | null}).last_seen_at =
        "not-a-date";
    }],
    ["project created_at", (source: LegacyBackfillSource) => {
      (source.projects[0] as {created_at: string}).created_at =
        "2026-7-16T00:00:00.000Z";
    }],
  ] as const)("rejects non-canonical %s", (_name, mutate) => {
    const source = cloneSource();
    mutate(source);
    expectInvalid(source);
  });

  it.each([
    "workspaces",
    "user_accounts",
    "people",
    "person_account_links",
    "workspace_memberships",
    "workspace_directory_revisions",
    "role_assignments",
  ] as const)("rejects an existing row in %s", table => {
    const source = cloneSource();
    (source.targetRowCounts as Record<typeof table, number>)[table] = 1;
    expectInvalid(source);
  });
});

describe("legacy backfill plan", () => {
  it("computes exact deterministic target rows and session revocations", () => {
    const plan = computeLegacyBackfillPlan(validSource(), {
      appliedAt: APPLIED_AT,
    });

    expect(plan).toEqual({
      workspaces: [
        {
          id: "org-active",
          kind: "casual",
          name: "Active Workspace",
          created_at: EARLY,
          updated_at: EARLY,
        },
        {
          id: "org-suspended",
          kind: "casual",
          name: "Suspended Workspace",
          created_at: EARLY,
          updated_at: EARLY,
        },
      ],
      userAccounts: [
        {
          id: "user-disabled",
          display_name: "   ",
          email: " disabled@example.test ",
          status: "disabled",
          created_at: LATE,
          updated_at: LATE,
        },
        {
          id: "user-owner",
          display_name: "  Owner Name  ",
          email: "owner@example.test",
          status: "active",
          created_at: LATE,
          updated_at: LATE,
        },
        {
          id: "user-suspended",
          display_name: null,
          email: null,
          status: "active",
          created_at: LATE,
          updated_at: LATE,
        },
      ],
      people: [
        {
          id: "e06037a4-ebef-59cb-9878-d5a54e5a525c",
          display_name: "disabled@example.test",
          status: "disabled",
          created_at: LATE,
          updated_at: LATE,
        },
        {
          id: "d6380f65-8042-540e-b29b-4dec0ea7fab6",
          display_name: "Owner Name",
          status: "active",
          created_at: LATE,
          updated_at: LATE,
        },
        {
          id: "48770edc-2812-525e-81f2-06581afa0d92",
          display_name: "Legacy user",
          status: "active",
          created_at: LATE,
          updated_at: LATE,
        },
      ],
      personAccountLinks: [
        {
          id: "0c5209c1-7c10-5e9c-884f-4e4081436cdf",
          person_id: "e06037a4-ebef-59cb-9878-d5a54e5a525c",
          account_id: "user-disabled",
          status: "active",
          linked_at: LATE,
          unlinked_at: null,
        },
        {
          id: "b621aa37-914d-5353-9696-6fcab195e3c5",
          person_id: "d6380f65-8042-540e-b29b-4dec0ea7fab6",
          account_id: "user-owner",
          status: "active",
          linked_at: LATE,
          unlinked_at: null,
        },
        {
          id: "3aad0a98-daeb-5988-b35a-d8a2d94c2971",
          person_id: "48770edc-2812-525e-81f2-06581afa0d92",
          account_id: "user-suspended",
          status: "active",
          linked_at: LATE,
          unlinked_at: null,
        },
      ],
      workspaceMemberships: [
        {
          id: "3fca1e36-0468-5bf8-a330-ddc2dbce13a0",
          workspace_id: "org-active",
          account_id: "user-disabled",
          role: "member",
          status: "ended",
          started_at: LATE,
          ended_at: APPLIED_AT,
        },
        {
          id: "dbf1e4ce-4623-5d09-8fe4-c139057ba71e",
          workspace_id: "org-active",
          account_id: "user-owner",
          role: "admin",
          status: "active",
          started_at: LATE,
          ended_at: null,
        },
        {
          id: "f8dda7b0-9cf1-5c7e-a87a-46009ec19e42",
          workspace_id: "org-suspended",
          account_id: "user-suspended",
          role: "member",
          status: "ended",
          started_at: LATE,
          ended_at: APPLIED_AT,
        },
      ],
      workspaceDirectoryRevisions: [
        {workspace_id: "org-active", revision: 0, updated_at: EARLY},
        {workspace_id: "org-suspended", revision: 0, updated_at: EARLY},
      ],
      roleAssignments: [
        {
          id: "f309de35-342f-5556-a3d9-0928855c5f17",
          account_id: "user-disabled",
          scope_kind: "workspace",
          workspace_id: "org-active",
          school_id: null,
          class_group_id: null,
          project_id: null,
          role: "member",
          status: "ended",
          started_at: LATE,
          ended_at: APPLIED_AT,
        },
        {
          id: "718b620c-6011-5d0b-9c25-2c0bed006dc1",
          account_id: "user-owner",
          scope_kind: "workspace",
          workspace_id: "org-active",
          school_id: null,
          class_group_id: null,
          project_id: null,
          role: "admin",
          status: "active",
          started_at: LATE,
          ended_at: null,
        },
        {
          id: "01f52dc5-6582-5ed1-b40e-0da021b4096b",
          account_id: "user-suspended",
          scope_kind: "workspace",
          workspace_id: "org-suspended",
          school_id: null,
          class_group_id: null,
          project_id: null,
          role: "member",
          status: "ended",
          started_at: LATE,
          ended_at: APPLIED_AT,
        },
        {
          id: "77c89942-5a3e-5d80-b743-725e9fcc886b",
          account_id: "user-owner",
          scope_kind: "project",
          workspace_id: null,
          school_id: null,
          class_group_id: null,
          project_id: "project-1",
          role: "owner",
          status: "active",
          started_at: LATE,
          ended_at: null,
        },
        {
          id: "a30f4512-3c73-5033-ab8a-6b76c4c445e2",
          account_id: "user-disabled",
          scope_kind: "project",
          workspace_id: null,
          school_id: null,
          class_group_id: null,
          project_id: "project-1",
          role: "editor",
          status: "ended",
          started_at: LATE,
          ended_at: APPLIED_AT,
        },
      ],
      sessionIdsToRevoke: ["session-unrevoked"],
    });
    expect(plan.workspaceMemberships).toHaveLength(3);
    expect(plan.roleAssignments).toHaveLength(5);
    expect(
      plan.roleAssignments.filter(
        row =>
          row.scope_kind === "project" &&
          row.account_id === "user-owner" &&
          row.role === "owner",
      ),
    ).toHaveLength(1);
  });

  it.each(["owner", "host", "editor", "commenter", "viewer"] as const)(
    "preserves exact non-owner project role %s",
    role => {
      const source = validSource();
      (source.projectMembers[0] as {role: string}).role = role;

      const plan = computeLegacyBackfillPlan(source, {appliedAt: APPLIED_AT});

      expect(
        plan.roleAssignments.find(
          row =>
            row.scope_kind === "project" &&
            row.account_id === "user-disabled",
        )?.role,
      ).toBe(role);
    },
  );

  it("orders plan arrays by SQLite-compatible binary text order", () => {
    const source = cloneSource();
    const replacements = new Map([
      ["org-active", "org-\u{10000}"],
      ["org-suspended", "org-\uE000"],
    ]);
    for (const organization of source.organizations) {
      (organization as {id: string}).id = replacements.get(organization.id)!;
    }
    for (const user of source.users) {
      (user as {primary_organization_id: string}).primary_organization_id =
        replacements.get(user.primary_organization_id)!;
    }
    for (const membership of source.memberships) {
      (membership as {organization_id: string}).organization_id =
        replacements.get(membership.organization_id)!;
    }
    for (const session of source.sessions) {
      (session as {organization_id: string}).organization_id =
        replacements.get(session.organization_id)!;
    }
    for (const project of source.projects) {
      (project as {organization_id: string}).organization_id =
        replacements.get(project.organization_id)!;
    }

    const plan = computeLegacyBackfillPlan(source, {appliedAt: APPLIED_AT});

    expect(plan.workspaces.map(row => row.id)).toEqual([
      "org-\uE000",
      "org-\u{10000}",
    ]);
  });

  it("returns immutable arrays and rows", () => {
    const plan = computeLegacyBackfillPlan(validSource(), {
      appliedAt: APPLIED_AT,
    });

    expect(Object.isFrozen(plan)).toBe(true);
    expect(Object.isFrozen(plan.workspaces)).toBe(true);
    expect(Object.isFrozen(plan.workspaces[0])).toBe(true);
    expect(Object.isFrozen(plan.roleAssignments)).toBe(true);
    expect(Object.isFrozen(plan.sessionIdsToRevoke)).toBe(true);
  });
});

describe("legacy backfill source reader", () => {
  it("reads exact fields in deterministic source order and target counts", () => {
    const db = new Database(":memory:");
    try {
      r1BaselineMigration.apply(db);
      r1IdentityCoreMigration.apply(db);
      r1SchoolRosterMigration.apply(db);
      r1AccessImportAuditMigration.apply(db);
      db.exec(`
        INSERT INTO organizations (id, name, status, created_at) VALUES
          ('org-z', 'Zed', 'active', '${EARLY}'),
          ('org-a', 'Alpha', 'active', '${EARLY}');
        INSERT INTO users (
          id, primary_organization_id, display_name, email, status,
          created_at, updated_at
        ) VALUES
          ('user-z', 'org-z', NULL, NULL, 'active', '${EARLY}', '${LATE}'),
          ('user-a', 'org-a', 'A', 'a@example.test', 'active', '${EARLY}', '${LATE}');
        INSERT INTO organization_memberships (
          organization_id, user_id, role
        ) VALUES
          ('org-z', 'user-z', 'member'),
          ('org-a', 'user-a', 'admin');
        INSERT INTO sessions (
          id_hash, user_id, organization_id, csrf_hash, created_at,
          expires_at, revoked_at, last_seen_at
        ) VALUES
          ('session-z', 'user-z', 'org-z', 'csrf-z', '${EARLY}', '${LATE}', NULL, NULL),
          ('session-a', 'user-a', 'org-a', 'csrf-a', '${EARLY}', '${LATE}', NULL, '${EARLY}');
        INSERT INTO projects (
          id, organization_id, owner_user_id, title, head_revision,
          created_at, updated_at
        ) VALUES
          ('project-z', 'org-z', 'user-z', 'Z', 0, '${EARLY}', '${LATE}'),
          ('project-a', 'org-a', 'user-a', 'A', 0, '${EARLY}', '${LATE}');
        INSERT INTO project_members (project_id, user_id, role) VALUES
          ('project-z', 'user-z', 'owner'),
          ('project-a', 'user-a', 'owner');
      `);

      const source = readLegacyBackfillSource(db);

      expect(source.organizations.map(row => row.id)).toEqual(["org-a", "org-z"]);
      expect(source.users.map(row => row.id)).toEqual(["user-a", "user-z"]);
      expect(source.memberships.map(row => row.organization_id)).toEqual([
        "org-a",
        "org-z",
      ]);
      expect(source.sessions.map(row => row.id_hash)).toEqual([
        "session-a",
        "session-z",
      ]);
      expect(source.projects.map(row => row.id)).toEqual([
        "project-a",
        "project-z",
      ]);
      expect(source.projectMembers.map(row => row.project_id)).toEqual([
        "project-a",
        "project-z",
      ]);
      expect(source.targetRowCounts).toEqual({
        workspaces: 0,
        user_accounts: 0,
        people: 0,
        person_account_links: 0,
        workspace_memberships: 0,
        workspace_directory_revisions: 0,
        role_assignments: 0,
      });
    } finally {
      db.close();
    }
  });
});
