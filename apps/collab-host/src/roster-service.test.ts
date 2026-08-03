import {describe, expect, it, vi} from "vitest";
import {ROSTER_SHEET_COLUMNS} from "@blocksync/classroom-access";
import {DRIVE_FILE_SCOPE} from "@blocksync/google-drive-sync";
import {openAdminDb} from "./admin-db.js";
import {
  createAdminGoogleCredentialStore,
  type AdminGoogleCredentialStore,
} from "./admin-google-credential-store.js";
import {testAdminGoogleCryptoKeys} from "./admin-google-oauth.js";
import {createRosterService, RosterServiceError, syncRosterFromSheet} from "./roster-service.js";

function header(): string {
  return ROSTER_SHEET_COLUMNS.join(",");
}

describe("roster-service", () => {
  it("creates roster, imports CSV, applies preview with audit and revision bump", () => {
    const db = openAdminDb(":memory:");
    const admin = db.upsertAdminFromLogin({
      subject: "sub-1",
      email: "teacher@school.example",
      displayName: "Teacher",
    });
    const service = createRosterService(db.sqlite);
    const roster = service.createRoster(admin.adminId, {title: "3年A組"});
    expect(roster.rosterRevision).toBe(0);

    const csv = [
      header(),
      "S001,山田太郎,007,yamada01,A,true",
      "S002,佐藤花子,02,sato02,A,true",
    ].join("\n");
    const preview = service.createImportFromCsv(roster.rosterId, admin.adminId, csv);
    expect(preview.baseRosterRevision).toBe(0);
    expect(preview.rows.some(row => row.category === "add")).toBe(true);
    expect(preview.previewHash).toMatch(/^[0-9a-f]{64}$/);

    const result = service.applyImport({
      rosterId: roster.rosterId,
      importId: preview.import.importId,
      ownerAdminId: admin.adminId,
      previewHash: preview.previewHash,
      baseRosterRevision: preview.baseRosterRevision,
      deactivateMissing: preview.deactivateMissing,
    });
    expect(result.roster.rosterRevision).toBe(1);
    expect(result.import.status).toBe("applied");

    const students = service.listStudents(roster.rosterId, admin.adminId);
    expect(students).toHaveLength(2);
    expect(students.find(s => s.studentCode === "S001")?.attendanceNumber).toBe(
      "007",
    );

    const auditCount = db.sqlite
      .prepare(`SELECT COUNT(*) AS c FROM classroom_audit_events WHERE roster_id = ?`)
      .get(roster.rosterId) as {c: number};
    expect(auditCount.c).toBeGreaterThan(0);

    db.close();
  });

  it("rejects stale preview_hash on apply", () => {
    const db = openAdminDb(":memory:");
    const admin = db.upsertAdminFromLogin({
      subject: "sub-2",
      email: "teacher2@school.example",
      displayName: "Teacher",
    });
    const service = createRosterService(db.sqlite);
    const roster = service.createRoster(admin.adminId, {title: "名簿"});
    const csv = [header(), "S001,山田,01,y,A,true"].join("\n");
    const preview = service.createImportFromCsv(roster.rosterId, admin.adminId, csv);

    expect(() =>
      service.applyImport({
        rosterId: roster.rosterId,
        importId: preview.import.importId,
        ownerAdminId: admin.adminId,
        previewHash: "deadbeef".padEnd(64, "0"),
        baseRosterRevision: preview.baseRosterRevision,
        deactivateMissing: preview.deactivateMissing,
      }),
    ).toThrow(RosterServiceError);

    expect(service.listStudents(roster.rosterId, admin.adminId)).toHaveLength(0);
    expect(service.getRoster(roster.rosterId, admin.adminId)?.rosterRevision).toBe(0);
    db.close();
  });

  it("allows only one apply winner per roster revision", () => {
    const db = openAdminDb(":memory:");
    const admin = db.upsertAdminFromLogin({
      subject: "sub-concurrent",
      email: "teacher-concurrent@school.example",
      displayName: "Teacher",
    });
    const service = createRosterService(db.sqlite);
    const roster = service.createRoster(admin.adminId, {title: "名簿"});
    const previewA = service.createImportFromCsv(
      roster.rosterId,
      admin.adminId,
      [header(), "S001,山田,01,y,A,true"].join("\n"),
    );
    const previewB = service.createImportFromCsv(
      roster.rosterId,
      admin.adminId,
      [header(), "S002,佐藤,02,s,B,true"].join("\n"),
    );

    const applied = service.applyImport({
      rosterId: roster.rosterId,
      importId: previewA.import.importId,
      ownerAdminId: admin.adminId,
      previewHash: previewA.previewHash,
      baseRosterRevision: previewA.baseRosterRevision,
      deactivateMissing: previewA.deactivateMissing,
    });
    expect(applied.roster.rosterRevision).toBe(1);

    let loserCode = "";
    try {
      service.applyImport({
        rosterId: roster.rosterId,
        importId: previewB.import.importId,
        ownerAdminId: admin.adminId,
        previewHash: previewB.previewHash,
        baseRosterRevision: previewB.baseRosterRevision,
        deactivateMissing: previewB.deactivateMissing,
      });
    } catch (error) {
      expect(error).toBeInstanceOf(RosterServiceError);
      loserCode = (error as RosterServiceError).code;
    }
    expect(["STALE_PREVIEW", "REVISION_CONFLICT"]).toContain(loserCode);

    const students = service.listStudents(roster.rosterId, admin.adminId);
    expect(students).toHaveLength(1);
    expect(students[0]?.studentCode).toBe("S001");
    expect(
      service.getImport(roster.rosterId, previewB.import.importId, admin.adminId)
        ?.status,
    ).toBe("preview_ready");
    db.close();
  });

  it("links existing owner student_code into another roster on apply", () => {
    const db = openAdminDb(":memory:");
    const admin = db.upsertAdminFromLogin({
      subject: "sub-cross",
      email: "teacher-cross@school.example",
      displayName: "Teacher",
    });
    const service = createRosterService(db.sqlite);
    const rosterA = service.createRoster(admin.adminId, {title: "A組"});
    const rosterB = service.createRoster(admin.adminId, {title: "B組"});
    const seed = service.createImportFromCsv(
      rosterA.rosterId,
      admin.adminId,
      [header(), "S001,共有,01,shared,A,true"].join("\n"),
    );
    service.applyImport({
      rosterId: rosterA.rosterId,
      importId: seed.import.importId,
      ownerAdminId: admin.adminId,
      previewHash: seed.previewHash,
      baseRosterRevision: seed.baseRosterRevision,
      deactivateMissing: seed.deactivateMissing,
    });

    const linkPreview = service.createImportFromCsv(
      rosterB.rosterId,
      admin.adminId,
      [header(), "S001,共有更新,01,shared,A,true"].join("\n"),
    );
    expect(linkPreview.rows.some(row => row.category === "add")).toBe(false);
    expect(linkPreview.rows.some(row => row.category === "update")).toBe(true);

    service.applyImport({
      rosterId: rosterB.rosterId,
      importId: linkPreview.import.importId,
      ownerAdminId: admin.adminId,
      previewHash: linkPreview.previewHash,
      baseRosterRevision: linkPreview.baseRosterRevision,
      deactivateMissing: linkPreview.deactivateMissing,
    });

    expect(service.listStudents(rosterB.rosterId, admin.adminId)).toHaveLength(1);
    expect(
      service.listStudents(rosterB.rosterId, admin.adminId)[0]?.displayName,
    ).toBe("共有更新");
    db.close();
  });

  it("rejects apply when preview has blocking rows", () => {
    const db = openAdminDb(":memory:");
    const admin = db.upsertAdminFromLogin({
      subject: "sub-3",
      email: "teacher3@school.example",
      displayName: "Teacher",
    });
    const service = createRosterService(db.sqlite);
    const roster = service.createRoster(admin.adminId, {title: "名簿"});
    const csv = [
      header(),
      "S001,重複,01,a,A,true",
      "S001,重複2,02,b,B,true",
    ].join("\n");
    const preview = service.createImportFromCsv(roster.rosterId, admin.adminId, csv);

    expect(() =>
      service.applyImport({
        rosterId: roster.rosterId,
        importId: preview.import.importId,
        ownerAdminId: admin.adminId,
        previewHash: preview.previewHash,
        baseRosterRevision: preview.baseRosterRevision,
        deactivateMissing: preview.deactivateMissing,
      }),
    ).toThrow(RosterServiceError);

    db.close();
  });

  it("syncs roster from Google Sheet and deactivates missing rows", async () => {
    const db = openAdminDb(":memory:");
    const admin = db.upsertAdminFromLogin({
      subject: "sub-sheet",
      email: "teacher-sheet@school.example",
      displayName: "Teacher",
    });
    const service = createRosterService(db.sqlite);
    const roster = service.createRoster(admin.adminId, {title: "Sheet roster"});
    service.updateRoster(roster.rosterId, admin.adminId, {
      sheetSpreadsheetId: "sheet-123",
      sheetTabName: "Roster",
      sheetRange: null,
    });

    const seed = service.createImportFromCsv(
      roster.rosterId,
      admin.adminId,
      [header(), "S001,山田,01,y,A,true", "S002,佐藤,02,s,B,true"].join("\n"),
    );
    service.applyImport({
      rosterId: roster.rosterId,
      importId: seed.import.importId,
      ownerAdminId: admin.adminId,
      previewHash: seed.previewHash,
      baseRosterRevision: seed.baseRosterRevision,
      deactivateMissing: seed.deactivateMissing,
    });

    const store = createAdminGoogleCredentialStore(db.sqlite, testAdminGoogleCryptoKeys());
    store.upsertCredential({
      adminId: admin.adminId,
      googleSubject: "google-sub",
      googleEmail: admin.email,
      scope: DRIVE_FILE_SCOPE,
      refreshToken: "refresh-1",
      accessToken: "access-1",
      accessExpiresAt: Date.now() + 3_600_000,
      nowIso: new Date().toISOString(),
    });

    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/values/")) {
        return new Response(
          JSON.stringify({
            values: [
              header().split(","),
              ["S001", "山田更新", "01", "y", "A", "true"],
            ],
          }),
          {status: 200},
        );
      }
      throw new Error(`unexpected fetch ${url}`);
    });

    const result = await syncRosterFromSheet(
      db.sqlite,
      {
        oauthConfig: {
          clientId: "client",
          clientSecret: "secret",
          fetch: fetchMock,
        },
        credentialStore: store,
        fetch: fetchMock,
      },
      roster.rosterId,
      admin.adminId,
    );

    expect(result.syncStatus).toBe("active");
    expect(result.rosterRevision).toBe(2);
    const students = service.listStudents(roster.rosterId, admin.adminId);
    expect(students.find(s => s.studentCode === "S001")?.displayName).toBe("山田更新");
    expect(students.find(s => s.studentCode === "S002")?.active).toBe(false);

    const syncedAudit = db.sqlite
      .prepare(
        `SELECT COUNT(*) AS c FROM classroom_audit_events
         WHERE roster_id = ? AND event_type = 'roster.sheet.synced'`,
      )
      .get(roster.rosterId) as {c: number};
    expect(syncedAudit.c).toBe(1);
    db.close();
  });
});
