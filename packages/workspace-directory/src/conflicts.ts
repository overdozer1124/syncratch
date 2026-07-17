import type {
  Enrollment,
  PersonAccountLink,
  School,
  Workspace,
} from "./models.js";
import {
  fail,
  issue,
  ok,
  type ValidationIssue,
  type ValidationResult,
} from "./validation.js";

function rangesOverlap(
  aStart: string,
  aEnd: string | null,
  bStart: string,
  bEnd: string | null,
): boolean {
  const aEndsBeforeB = aEnd !== null && aEnd < bStart;
  const bEndsBeforeA = bEnd !== null && bEnd < aStart;
  return !(aEndsBeforeB || bEndsBeforeA);
}

export function findActiveAccountLinkConflicts(
  links: readonly PersonAccountLink[],
): readonly ValidationIssue[] {
  const active = links.filter((link) => link.status === "active");
  const issues: ValidationIssue[] = [];

  const byAccount = new Map<string, PersonAccountLink[]>();
  const byPerson = new Map<string, PersonAccountLink[]>();

  for (const link of active) {
    const accountGroup = byAccount.get(link.accountId) ?? [];
    accountGroup.push(link);
    byAccount.set(link.accountId, accountGroup);

    const personGroup = byPerson.get(link.personId) ?? [];
    personGroup.push(link);
    byPerson.set(link.personId, personGroup);
  }

  for (const [accountId, group] of byAccount) {
    if (group.length < 2) continue;
    issues.push(
      issue(
        "active_account_link_conflict",
        `account ${accountId} has multiple active person links`,
        "accountId",
      ),
    );
  }

  for (const [personId, group] of byPerson) {
    if (group.length < 2) continue;
    const accountIds = new Set(group.map((link) => link.accountId));
    if (accountIds.size > 1) {
      issues.push(
        issue(
          "active_person_link_conflict",
          `person ${personId} has multiple active account links`,
          "personId",
        ),
      );
    }
  }

  return issues;
}

export function findOverlappingEnrollmentConflicts(
  enrollments: readonly Enrollment[],
): readonly ValidationIssue[] {
  const active = enrollments.filter(
    (enrollment) => enrollment.status === "active",
  );
  const issues: ValidationIssue[] = [];
  const seen = new Set<string>();

  for (let i = 0; i < active.length; i++) {
    for (let j = i + 1; j < active.length; j++) {
      const left = active[i]!;
      const right = active[j]!;
      if (
        left.personId !== right.personId ||
        left.classGroupId !== right.classGroupId
      ) {
        continue;
      }
      if (
        !rangesOverlap(
          left.startDate,
          left.endDate,
          right.startDate,
          right.endDate,
        )
      ) {
        continue;
      }

      const key = [left.id, right.id].sort().join("|");
      if (seen.has(key)) continue;
      seen.add(key);

      issues.push(
        issue(
          "overlapping_enrollment",
          `person ${left.personId} has overlapping active enrollments in class ${left.classGroupId}`,
          "enrollment",
        ),
      );
    }
  }

  return issues;
}

export function findAttendanceNumberConflicts(
  enrollments: readonly Enrollment[],
): readonly ValidationIssue[] {
  const candidates = enrollments.filter(
    (enrollment) =>
      enrollment.status === "active" && enrollment.attendanceNumber !== null,
  );
  const issues: ValidationIssue[] = [];
  const seen = new Set<string>();

  for (let i = 0; i < candidates.length; i++) {
    for (let j = i + 1; j < candidates.length; j++) {
      const left = candidates[i]!;
      const right = candidates[j]!;
      if (left.id === right.id) continue;
      if (left.classGroupId !== right.classGroupId) continue;
      if (left.attendanceNumber !== right.attendanceNumber) continue;
      if (
        !rangesOverlap(
          left.startDate,
          left.endDate,
          right.startDate,
          right.endDate,
        )
      ) {
        continue;
      }

      const key = [left.id, right.id].sort().join("|");
      if (seen.has(key)) continue;
      seen.add(key);

      issues.push(
        issue(
          "attendance_number_conflict",
          `attendance number ${left.attendanceNumber} conflicts in class ${left.classGroupId}`,
          "attendanceNumber",
        ),
      );
    }
  }

  return issues;
}

export function assertSchoolWorkspaceKind(
  workspace: Workspace,
  school: School,
): ValidationResult<true> {
  const issues: ValidationIssue[] = [];

  if (workspace.kind !== "school") {
    issues.push(
      issue(
        "workspace_kind_mismatch",
        `school requires workspace kind school, got ${workspace.kind}`,
        "kind",
      ),
    );
  }

  if (school.workspaceId !== workspace.id) {
    issues.push(
      issue(
        "workspace_id_mismatch",
        `school workspaceId ${school.workspaceId} does not match workspace ${workspace.id}`,
        "workspaceId",
      ),
    );
  }

  return issues.length === 0 ? ok(true) : fail(issues);
}
