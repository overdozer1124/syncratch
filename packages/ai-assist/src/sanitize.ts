/**
 * Spec §35: minimize PII before sending to AI providers.
 */

const EMAIL_RE = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;
const ATTENDANCE_RE = /出席番号\s*[:：]?\s*\d+/g;
const PHONE_RE = /(?:\+?\d{1,3}[-\s]?)?(?:\d{2,4}[-\s]?){2,3}\d{3,4}/g;

export interface SanitizeResult {
  text: string;
  redacted: boolean;
}

export function sanitizeAiText(input: string): SanitizeResult {
  let text = input;
  let redacted = false;

  const replace = (re: RegExp, replacement: string): void => {
    const next = text.replace(re, replacement);
    if (next !== text) {
      redacted = true;
      text = next;
    }
  };

  replace(EMAIL_RE, "[email]");
  replace(ATTENDANCE_RE, "[attendance]");
  replace(PHONE_RE, "[phone]");

  // Strip obvious Google / collab secrets that must never leave the client.
  replace(/ya29\.[A-Za-z0-9_\-.]+/g, "[token]");
  replace(/sk-(?:ant-|or-|proj-)?[A-Za-z0-9_\-]{8,}/g, "[api-key]");
  replace(/gsk_[A-Za-z0-9]{8,}/g, "[api-key]");
  replace(/AIza[A-Za-z0-9_\-]{8,}/g, "[api-key]");

  return {text, redacted};
}

/**
 * Cap long strings to keep token usage low for advice requests.
 */
export function truncateForTokens(
  text: string,
  maxChars: number,
): string {
  if (text.length <= maxChars) return text;
  return `${text.slice(0, Math.max(0, maxChars - 1))}…`;
}
