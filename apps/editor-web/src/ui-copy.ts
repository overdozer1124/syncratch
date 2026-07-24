const DRIVE_MESSAGES: Array<[RegExp, string]> = [
  [
    /connect google/i,
    "先に「Google とつなぐ」を押してください。",
  ],
  [
    /permission denied|not editable|access token|authorization/i,
    "この作品を使う権限がありません。先生か作品を送った人に確認してください。",
  ],
  [
    /quota|rate limit|size limit|exceeds the size/i,
    "Google ドライブに保存できる大きさや回数をこえました。",
  ],
  [
    /not found|no longer/i,
    "Google ドライブで作品が見つかりませんでした。",
  ],
  [
    /not a valid|not supported|invalid .*sb3/i,
    "Scratch の作品ファイルではありません。",
  ],
  [
    /collaboration bootstrap is not ready/i,
    "作品を受け取っています。準備が終わるまで、Google ドライブへの保存は待ちます。",
  ],
  [
    /collaboration is disconnected|drive saving is paused/i,
    "友だちとのつながりが切れている間は、Google ドライブへの自動保存を止めています。",
  ],
  [
    /resolve the collaboration conflict/i,
    "作品のちがいを確認してから、Google ドライブに保存してください。",
  ],
  [
    /confirm drive overwrite|previous conflict/i,
    "前にちがいがあったので、上書きする前に「Google ドライブに保存」を押してください。",
  ],
  [
    /room creator|room leader|only .* save/i,
    "いっしょに作るリンクを作った人だけが Google ドライブに保存できます。",
  ],
  [
    /differs|changed during|conflict/i,
    "このパソコンと Google ドライブの作品がちがいます。内容をたしかめてください。",
  ],
];

export function friendlyDriveMessage(message?: string): string | undefined {
  if (!message) return undefined;
  for (const [pattern, copy] of DRIVE_MESSAGES) {
    if (pattern.test(message)) return copy;
  }
  return "Google ドライブでエラーが起きました。もう一度ためしてください。";
}

const COLLAB_MESSAGES: Array<[RegExp, string]> = [
  [
    /signaling is not configured/i,
    "このパソコンでは、いっしょに作る機能を使えません。",
  ],
  [
    /invalid collaboration invite/i,
    "いっしょに作るリンクが正しくありません。リンクを全部コピーしてもらってください。",
  ],
  [
    /bootstrap is not ready/i,
    "作品を受け取っています。準備が終わるまで待ってください。",
  ],
  [
    /disconnected/i,
    "友だちとのつながりが切れました。作品はこのパソコンに保存されています。",
  ],
  [
    /conflict/i,
    "作品が別の場所でも変わりました。内容をたしかめてください。",
  ],
];

/** Mapped collaboration copy only; undefined when no pattern matches. */
export function matchFriendlyCollaborationMessage(
  message: string,
): string | undefined {
  for (const [pattern, copy] of COLLAB_MESSAGES) {
    if (pattern.test(message)) return copy;
  }
  return undefined;
}

export function friendlyCollaborationMessage(
  message?: string,
): string | undefined {
  if (!message) return undefined;
  return (
    matchFriendlyCollaborationMessage(message) ??
    "友だちとつながりませんでした。インターネットをたしかめてください。"
  );
}

/** Shown after creating an invite link and copying it to the clipboard. */
export const INVITE_LINK_COPIED_TOAST =
  "いっしょに作るリンクがコピーされました。友だちに教えてね。";

export const INVITE_LINK_COPY_FAILED_TOAST =
  "コピーできませんでした。リンクを選んでコピーしてください。";

export const drivePanelStatusText: Record<
  | "not-configured"
  | "disconnected"
  | "connected"
  | "syncing"
  | "synced"
  | "unsynced"
  | "conflict",
  string
> = {
  "not-configured": "このパソコンでは Google ドライブを使えません",
  disconnected: "Google ドライブにつながっていません",
  connected: "Google ドライブにつながりました",
  syncing: "Google ドライブに保存中…",
  synced: "Google ドライブに保存しました",
  unsynced: "Google ドライブにはまだ保存していません",
  conflict: "Google ドライブの作品が別の場所で変わっています",
};
