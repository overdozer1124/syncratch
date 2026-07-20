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
    /differs|changed during|conflict/i,
    "このパソコンと Google ドライブの作品がちがいます。内容をたしかめてください。",
  ],
  [
    /room creator|room leader|only .* save/i,
    "いっしょに作るリンクを作った人だけが Google ドライブに保存できます。",
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

export function friendlyCollaborationMessage(
  message?: string,
): string | undefined {
  if (!message) return undefined;
  for (const [pattern, copy] of COLLAB_MESSAGES) {
    if (pattern.test(message)) return copy;
  }
  return "友だちとつながりませんでした。インターネットをたしかめてください。";
}
