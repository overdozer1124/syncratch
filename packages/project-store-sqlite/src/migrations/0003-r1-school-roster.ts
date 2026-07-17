import type Database from "better-sqlite3";
import type {SchemaMigration} from "./types.js";

export const r1SchoolRosterChecksumSource = [
  "version=3",
  "name=r1-school-roster",
  "createSchools",
  "createAcademicYears",
  "createGrades",
  "createClassGroups",
  "createEnrollments",
  "createStaffAssignments",
  "indexes:ux_enroll_active_attendance,ux_enroll_active_person_class,ux_staff_active_person_class_role,idx_schools_workspace,idx_ay_school,idx_grades_ay,idx_cg_ay,idx_cg_grade,idx_enroll_class,idx_enroll_person,idx_staff_class,idx_staff_person",
].join("\n");

export const r1SchoolRosterMigration: SchemaMigration = {
  version: 3,
  name: "r1-school-roster",
  checksumSource: r1SchoolRosterChecksumSource,
  checksum: "df44a5ed6e7e07628ceb9423f9d231b87fe53243555eed2dfd500b6774043b52",
  apply(db: Database.Database): void {
    db.exec(`
CREATE TABLE schools (
  id TEXT PRIMARY KEY CHECK (length(trim(id)) > 0),
  workspace_id TEXT NOT NULL REFERENCES workspaces(id),
  name TEXT NOT NULL CHECK (length(trim(name)) > 0),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (id, workspace_id)
);

CREATE TABLE academic_years (
  id TEXT PRIMARY KEY CHECK (length(trim(id)) > 0),
  school_id TEXT NOT NULL REFERENCES schools(id),
  label TEXT NOT NULL CHECK (length(trim(label)) > 0),
  start_date TEXT NOT NULL,
  end_date TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('planned','active','closed')),
  CHECK (start_date <= end_date),
  UNIQUE (school_id, label)
);

CREATE TABLE grades (
  id TEXT PRIMARY KEY CHECK (length(trim(id)) > 0),
  academic_year_id TEXT NOT NULL REFERENCES academic_years(id),
  code TEXT NOT NULL CHECK (length(trim(code)) > 0),
  display_label TEXT NOT NULL CHECK (length(trim(display_label)) > 0),
  sort_order INTEGER NOT NULL CHECK (sort_order >= 0),
  UNIQUE (academic_year_id, code),
  UNIQUE (id, academic_year_id)
);

CREATE TABLE class_groups (
  id TEXT PRIMARY KEY CHECK (length(trim(id)) > 0),
  academic_year_id TEXT NOT NULL REFERENCES academic_years(id),
  grade_id TEXT NOT NULL,
  label TEXT NOT NULL CHECK (length(trim(label)) > 0),
  UNIQUE (academic_year_id, grade_id, label),
  FOREIGN KEY (grade_id, academic_year_id)
    REFERENCES grades(id, academic_year_id)
);

CREATE TABLE enrollments (
  id TEXT PRIMARY KEY CHECK (length(trim(id)) > 0),
  person_id TEXT NOT NULL REFERENCES people(id),
  class_group_id TEXT NOT NULL REFERENCES class_groups(id),
  status TEXT NOT NULL CHECK (status IN ('active','ended')),
  start_date TEXT NOT NULL,
  end_date TEXT,
  attendance_number TEXT,
  CHECK (end_date IS NULL OR start_date <= end_date),
  CHECK (
    (status = 'active' AND end_date IS NULL)
    OR (status = 'ended' AND end_date IS NOT NULL)
  ),
  CHECK (
    attendance_number IS NULL OR length(trim(attendance_number)) > 0
  )
);

CREATE TABLE staff_assignments (
  id TEXT PRIMARY KEY CHECK (length(trim(id)) > 0),
  person_id TEXT NOT NULL REFERENCES people(id),
  class_group_id TEXT NOT NULL REFERENCES class_groups(id),
  role TEXT NOT NULL CHECK (role IN ('teacher','assistant')),
  status TEXT NOT NULL CHECK (status IN ('active','ended')),
  start_date TEXT NOT NULL,
  end_date TEXT,
  CHECK (end_date IS NULL OR start_date <= end_date),
  CHECK (
    (status = 'active' AND end_date IS NULL)
    OR (status = 'ended' AND end_date IS NOT NULL)
  )
);

CREATE UNIQUE INDEX ux_enroll_active_attendance
  ON enrollments(class_group_id, attendance_number)
  WHERE status = 'active' AND attendance_number IS NOT NULL;

CREATE UNIQUE INDEX ux_enroll_active_person_class
  ON enrollments(person_id, class_group_id) WHERE status = 'active';

CREATE UNIQUE INDEX ux_staff_active_person_class_role
  ON staff_assignments(person_id, class_group_id, role)
  WHERE status = 'active';

CREATE INDEX IF NOT EXISTS idx_schools_workspace ON schools(workspace_id);
CREATE INDEX IF NOT EXISTS idx_ay_school ON academic_years(school_id);
CREATE INDEX IF NOT EXISTS idx_grades_ay ON grades(academic_year_id);
CREATE INDEX IF NOT EXISTS idx_cg_ay ON class_groups(academic_year_id);
CREATE INDEX IF NOT EXISTS idx_cg_grade ON class_groups(grade_id);
CREATE INDEX IF NOT EXISTS idx_enroll_class ON enrollments(class_group_id);
CREATE INDEX IF NOT EXISTS idx_enroll_person ON enrollments(person_id);
CREATE INDEX IF NOT EXISTS idx_staff_class ON staff_assignments(class_group_id);
CREATE INDEX IF NOT EXISTS idx_staff_person ON staff_assignments(person_id);
`);
  },
};
