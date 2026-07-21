const LEGACY_DEFAULT_TITLES: Readonly<Record<string, string>> = {
  "Local project": "新しい作品",
  "Drive project": "Google ドライブの作品",
  "共同編集プロジェクト": "友だちといっしょの作品",
};

export const DEFAULT_GUEST_COLLAB_TITLE = "友だちといっしょの作品";

export function friendlyProjectTitle(title: string): string {
  return LEGACY_DEFAULT_TITLES[title] ?? title;
}
