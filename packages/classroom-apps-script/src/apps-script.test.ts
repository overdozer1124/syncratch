import {readFileSync} from "node:fs";
import {runInNewContext} from "node:vm";
import {describe, expect, it} from "vitest";

function loadScript(activeEmail = "teacher@example.edu") {
  const source = readFileSync(
    new URL("../apps-script/Code.gs", import.meta.url),
    "utf8",
  );
  const outputs: Array<{text: string; setMimeType(type: string): unknown}> = [];
  const context = {
    ContentService: {
      MimeType: {JSON: "json"},
      createTextOutput(text: string) {
        const output = {
          text,
          setMimeType() {
            return output;
          },
        };
        outputs.push(output);
        return output;
      },
    },
    PropertiesService: {
      getScriptProperties: () => ({
        getProperty: (key: string) =>
          key === "BLOCKSYNC_GOOGLE_CLIENT_ID"
            ? "client-id.apps.googleusercontent.com"
            : key === "BLOCKSYNC_SHEET_ID"
              ? "sheet-id"
              : "",
      }),
    },
    UrlFetchApp: {
      fetch: () => ({
        getResponseCode: () => 200,
        getContentText: () => JSON.stringify({
          aud: "client-id.apps.googleusercontent.com",
          email: activeEmail,
          email_verified: "true",
          exp: String(Math.floor(Date.now() / 1000) + 300),
        }),
      }),
    },
    Utilities: {
      newBlob: (value: string) => ({getBytes: () => [...value]}),
      getUuid: () => "invitation-1",
    },
    JSON,
    Date,
  };
  runInNewContext(source, context);
  return context as typeof context & {
    _validateRequest(request: unknown): void;
    _verifyIdentityToken(token: string): string;
    _safeSheetText(value: unknown, field: string): string;
    _upsertRoom(
      request: {room: {roomId: string; classId: string; driveFileId: string}},
      actor: string,
    ): unknown;
    _roomsSheet(): unknown;
    _objects(sheet: unknown): Array<Record<string, unknown>>;
    _requireTeacher(actor: string, classId: string): void;
    doPost(event: {postData: {contents: string; length: number}}): {text: string};
  };
}

describe("deployable Apps Script boundary", () => {
  it("rejects project and Yjs payload keys before accessing Sheets", () => {
    const script = loadScript();
    expect(() => script._validateRequest({
      action: "upsertRoom",
      room: {projectDocument: {targets: []}},
    })).toThrow(/must not contain project payloads/i);
    expect(() => script._validateRequest({
      action: "createInvitation",
      metadata: {yjsUpdate: "bytes"},
    })).toThrow(/must not contain project payloads/i);
  });

  it("denies unauthenticated requests without exposing internal details", () => {
    const script = loadScript("");
    const body = JSON.stringify({action: "listRoster", classId: "class-1"});
    const response = script.doPost({
      postData: {contents: body, length: body.length},
    });

    expect(JSON.parse(response.text)).toEqual({
      ok: false,
      error: {code: "FORBIDDEN", message: "Google account access is required"},
    });
  });

  it("derives the actor only from a verified Google ID token", () => {
    const script = loadScript("teacher@example.edu");

    expect(script._verifyIdentityToken("signed-google-id-token"))
      .toBe("teacher@example.edu");
  });

  it("prevents a teacher from moving another class's existing room", () => {
    const script = loadScript();
    script._roomsSheet = () => ({});
    script._objects = () => [{_row: 2, roomId: "room-1", classId: "class-b"}];
    script._requireTeacher = (_actor, classId) => {
      if (classId !== "class-a") throw new Error("not this class");
    };

    expect(() => script._upsertRoom({
      room: {roomId: "room-1", classId: "class-a", driveFileId: "drive-a"},
    }, "teacher@example.edu")).toThrow("not this class");
  });

  it("does not expose unexpected Apps Script error details", () => {
    const script = loadScript();
    const body = JSON.stringify({
      action: "listRoster",
      classId: "class-1",
      identityToken: "signed-google-id-token",
    });

    expect(JSON.parse(script.doPost({
      postData: {contents: body, length: body.length},
    }).text)).toEqual({
      ok: false,
      error: {code: "UNAVAILABLE", message: "Classroom adapter is unavailable"},
    });
  });

  it("rejects values that Google Sheets would interpret as formulas", () => {
    const script = loadScript();

    expect(() => script._safeSheetText(
      "=IMPORTXML(\"https://attacker.invalid\")",
      "roomId",
    )).toThrow(/unsafe spreadsheet value/i);
    expect(script._safeSheetText("room-safe_123", "roomId"))
      .toBe("room-safe_123");
  });
});
