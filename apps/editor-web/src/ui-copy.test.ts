import {describe, expect, it} from "vitest";
import {
  friendlyCollaborationMessage,
  friendlyDriveMessage,
} from "./ui-copy.js";

describe("friendlyDriveMessage", () => {
  it("turns common Drive failures into short actionable Japanese", () => {
    expect(friendlyDriveMessage("Connect Google before saving to Drive")).toBe(
      "先に「Google とつなぐ」を押してください。",
    );
    expect(friendlyDriveMessage("Google Drive permission denied")).toBe(
      "この作品を使う権限がありません。先生か作品を送った人に確認してください。",
    );
    expect(friendlyDriveMessage("unexpected provider detail")).toBe(
      "Google ドライブでエラーが起きました。もう一度ためしてください。",
    );
  });
});

describe("friendlyCollaborationMessage", () => {
  it("explains invite and connection problems without technical words", () => {
    expect(
      friendlyCollaborationMessage("Collaboration signaling is not configured"),
    ).toBe("このパソコンでは、いっしょに作る機能を使えません。");
    expect(friendlyCollaborationMessage("Invalid collaboration invite")).toBe(
      "いっしょに作るリンクが正しくありません。リンクを全部コピーしてもらってください。",
    );
    expect(friendlyCollaborationMessage("unknown transport failure")).toBe(
      "友だちとつながりませんでした。インターネットをたしかめてください。",
    );
  });
});
