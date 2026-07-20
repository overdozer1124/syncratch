const LEGACY_DEFAULT_TITLES: Readonly<Record<string, string>> = {
  "Local project": "新しい作品",
  "Drive project": "Google ドライブの作品",
};

export function friendlyProjectTitle(title: string): string {
  return LEGACY_DEFAULT_TITLES[title] ?? title;
}
