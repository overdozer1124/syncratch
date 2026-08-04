import {ADMIN_CLASSROOM_FLAGS_PATH} from "@blocksync/classroom-access";

export interface AdminClassroomFlags {
  classroomRosterEnabled: boolean;
  adminGoogleCredentialEnabled: boolean;
  rosterSheetsEnabled: boolean;
  teacherDriveSubmissionEnabled: boolean;
  submissionPreviewEnabled: boolean;
}

export async function fetchAdminClassroomFlags(): Promise<AdminClassroomFlags | null> {
  try {
    const response = await fetch(ADMIN_CLASSROOM_FLAGS_PATH, {
      credentials: "same-origin",
      headers: {accept: "application/json"},
    });
    if (!response.ok) return null;
    const body = (await response.json()) as {
      ok?: boolean;
      flags?: Partial<AdminClassroomFlags>;
    };
    if (!body.ok || !body.flags) return null;
    return {
      classroomRosterEnabled: Boolean(body.flags.classroomRosterEnabled),
      adminGoogleCredentialEnabled: Boolean(body.flags.adminGoogleCredentialEnabled),
      rosterSheetsEnabled: Boolean(body.flags.rosterSheetsEnabled),
      teacherDriveSubmissionEnabled: Boolean(body.flags.teacherDriveSubmissionEnabled),
      submissionPreviewEnabled: Boolean(body.flags.submissionPreviewEnabled),
    };
  } catch {
    return null;
  }
}
