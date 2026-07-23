/**
 * Turn AI advice text into safe HTML with diagram boxes.
 * Diagrams are fenced by 【ず】…【/ず】 or ```zu / ```diagram fences.
 */

export function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function softenMarkdown(text: string): string {
  return text
    .replace(/\*\*(.+?)\*\*/g, "$1")
    .replace(/__(.+?)__/g, "$1")
    .replace(/^#{1,6}\s+/gm, "");
}

type AnswerPart =
  | {kind: "text"; text: string}
  | {kind: "diagram"; title: string; body: string};

const DIAGRAM_BLOCK_RE =
  /【ず】([^\n【]*)\n([\s\S]*?)【\/ず】|```(?:zu|diagram|ず)\n([\s\S]*?)```/g;

export function parseAiAnswerParts(content: string): AnswerPart[] {
  const source = content.trim();
  if (!source) return [];

  const parts: AnswerPart[] = [];
  let cursor = 0;
  DIAGRAM_BLOCK_RE.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = DIAGRAM_BLOCK_RE.exec(source)) !== null) {
    if (match.index > cursor) {
      parts.push({kind: "text", text: source.slice(cursor, match.index)});
    }
    if (match[2] != null) {
      parts.push({
        kind: "diagram",
        title: (match[1] ?? "").trim() || "ず",
        body: match[2].replace(/\s+$/, ""),
      });
    } else {
      parts.push({
        kind: "diagram",
        title: "ず",
        body: (match[3] ?? "").replace(/\s+$/, ""),
      });
    }
    cursor = match.index + match[0].length;
  }
  if (cursor < source.length) {
    parts.push({kind: "text", text: source.slice(cursor)});
  }
  return parts.filter(
    part =>
      (part.kind === "text" && part.text.trim().length > 0) ||
      (part.kind === "diagram" && part.body.trim().length > 0),
  );
}

/** Safe HTML for the AI answer panel. */
export function formatAiAnswerHtml(content: string): string {
  const parts = parseAiAnswerParts(content);
  if (parts.length === 0) {
    return `<p class="ai-answer-text">${escapeHtml(softenMarkdown(content))}</p>`;
  }

  return parts
    .map(part => {
      if (part.kind === "text") {
        return `<p class="ai-answer-text">${escapeHtml(softenMarkdown(part.text)).replace(/\n/g, "<br>")}</p>`;
      }
      const title = escapeHtml(part.title);
      const body = escapeHtml(part.body);
      return [
        `<figure class="ai-diagram">`,
        `<figcaption class="ai-diagram-title">${title}</figcaption>`,
        `<pre class="ai-diagram-body">${body}</pre>`,
        `</figure>`,
      ].join("");
    })
    .join("");
}
