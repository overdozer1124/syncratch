/**
 * Same-origin AI chat proxy. Forwards Authorization to providers; never stores keys.
 * Isolated from WebRTC signaling — project bytes never enter this path.
 */
import type {IncomingMessage, ServerResponse} from "node:http";
import {
  AI_CHAT_PROXY_PATH,
  extractBearerToken,
  forwardAiChat,
  parseAiChatProxyBody,
  type AiChatProxyResponse,
} from "@blocksync/ai-assist";

const MAX_BODY_BYTES = 64 * 1024;

function sendJson(
  res: ServerResponse,
  status: number,
  body: AiChatProxyResponse | {ok: false; code: string; message: string},
): void {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
  });
  res.end(payload);
}

function readBody(req: IncomingMessage, limit: number): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let total = 0;
    req.on("data", (chunk: Buffer) => {
      total += chunk.length;
      if (total > limit) {
        reject(new Error("body too large"));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

export function isAiChatProxyPath(urlPath: string): boolean {
  const pathOnly = urlPath.split("?")[0] ?? "";
  return pathOnly === AI_CHAT_PROXY_PATH;
}

export async function handleAiChatProxy(
  req: IncomingMessage,
  res: ServerResponse,
): Promise<boolean> {
  const urlPath = req.url ?? "/";
  if (!isAiChatProxyPath(urlPath)) return false;

  if (req.method === "OPTIONS") {
    res.writeHead(204, {
      "access-control-allow-methods": "POST, OPTIONS",
      "access-control-allow-headers": "content-type, authorization",
      "access-control-max-age": "86400",
    });
    res.end();
    return true;
  }

  if (req.method !== "POST") {
    sendJson(res, 405, {
      ok: false,
      code: "BAD_REQUEST",
      message: "POST required",
    });
    return true;
  }

  const apiKey = extractBearerToken(req.headers.authorization);
  if (!apiKey) {
    sendJson(res, 401, {
      ok: false,
      code: "UNAUTHORIZED",
      message: "Authorization Bearer token required",
    });
    return true;
  }

  let raw: Buffer;
  try {
    raw = await readBody(req, MAX_BODY_BYTES);
  } catch {
    sendJson(res, 413, {
      ok: false,
      code: "BAD_REQUEST",
      message: "request body too large",
    });
    return true;
  }

  let parsedJson: unknown;
  try {
    parsedJson = JSON.parse(raw.toString("utf8")) as unknown;
  } catch {
    sendJson(res, 400, {
      ok: false,
      code: "BAD_REQUEST",
      message: "invalid JSON",
    });
    return true;
  }

  const parsed = parseAiChatProxyBody(parsedJson);
  if (!parsed.ok) {
    sendJson(res, 400, {
      ok: false,
      code: "BAD_REQUEST",
      message: parsed.message,
    });
    return true;
  }

  const result = await forwardAiChat({
    apiKey,
    request: parsed.request,
  });

  if (!result.ok) {
    const status =
      result.code === "UNAUTHORIZED"
        ? 401
        : result.code === "RATE_LIMITED"
          ? 429
          : result.code === "UNSUPPORTED_PROVIDER" ||
              result.code === "BAD_REQUEST"
            ? 400
            : result.code === "UPSTREAM_TIMEOUT"
              ? 504
              : 502;
    sendJson(res, status, result);
    return true;
  }

  sendJson(res, 200, result);
  return true;
}
