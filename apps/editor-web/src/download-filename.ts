const MAX_BASENAME_LENGTH = 100;
const WINDOWS_FORBIDDEN_OR_CONTROL = /[\u0000-\u001f\u007f<>:"/\\|?*]/g;
const WINDOWS_RESERVED_NAME = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\..*)?$/i;

export function downloadFilename(title: string): string {
  const cleaned = title
    .replace(WINDOWS_FORBIDDEN_OR_CONTROL, "")
    .trim()
    .replace(/[ .]+$/g, "");
  const limited = Array.from(cleaned)
    .slice(0, MAX_BASENAME_LENGTH)
    .join("")
    .replace(/[ .]+$/g, "");
  const safeName =
    limited && !WINDOWS_RESERVED_NAME.test(limited) ? limited : "作品";
  return `${safeName}.sb3`;
}
