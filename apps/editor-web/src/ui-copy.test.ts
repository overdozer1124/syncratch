import {describe, expect, it} from "vitest";
import {
  drivePanelStatusText,
  friendlyCollaborationMessage,
  friendlyDriveMessage,
  INVITE_LINK_COPIED_TOAST,
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

  it("maps collaboration write-gate reasons without calling them Drive faults", () => {
    expect(
      friendlyDriveMessage("Collaboration bootstrap is not ready"),
    ).toBe(
      "作品を受け取っています。準備が終わるまで、Google ドライブへの保存は待ちます。",
    );
    expect(
      friendlyDriveMessage(
        "Collaboration is disconnected; Drive saving is paused",
      ),
    ).toBe(
      "友だちとのつながりが切れている間は、Google ドライブへの自動保存を止めています。",
    );
    expect(
      friendlyDriveMessage(
        "Resolve the collaboration conflict before saving to Drive",
      ),
    ).toBe(
      "作品のちがいを確認してから、Google ドライブに保存してください。",
    );
    expect(
      friendlyDriveMessage("Confirm Drive overwrite after a previous conflict"),
    ).toBe(
      "前にちがいがあったので、上書きする前に「Google ドライブに保存」を押してください。",
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

describe("INVITE_LINK_COPIED_TOAST", () => {
  it("tells friends the create-together link was copied", () => {
    expect(INVITE_LINK_COPIED_TOAST).toContain("コピーされました");
    expect(INVITE_LINK_COPIED_TOAST).toContain("友だちに教えてね");
  });
});

describe("drivePanelStatusText", () => {
  it("keeps Google Drive prefix so synced is not mistaken for local save", () => {
    expect(drivePanelStatusText.synced).toContain("Google ドライブ");
    expect(drivePanelStatusText.unsynced).toContain("Google ドライブ");
  });
});
