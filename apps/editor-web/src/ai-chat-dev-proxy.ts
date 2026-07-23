/**
 * Dev/preview middleware: same-origin POST /ai/chat using @blocksync/ai-assist.
 * Production Railway uses collab-host's handler; this keeps local vite usable.
 */
import type {IncomingMessage, ServerResponse} from "node:http";
import type {Connect, Plugin} from "vite";
import {
  AI_CHAT_PROXY_PATH,
  extractBearerToken,
  forwardAiChat,
  parseAiChatProxyBody,
} from "@blocksync/ai-assist";

const MAX_BODY_BYTES = 64 * 1024;

function readBody(
  req: IncomingMessage,
  limit: number,
): Promise<Buffer> {
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

function sendJson(
  res: ServerResponse,
  status: number,
  body: unknown,
): void {
  const payload = JSON.stringify(body);
  res.statusCode = status;
  res.setHeader("content-type", "application/json; charset=utf-8");
  res.setHeader("cache-control", "no-store");
  res.end(payload);
}

export function createAiChatDevMiddleware(): Connect.NextHandleFunction {
  return (req, res, next) => {
    const urlPath = req.url ?? "/";
    const pathOnly = urlPath.split("?")[0] ?? "";
    if (pathOnly !== AI_CHAT_PROXY_PATH) {
      next();
      return;
    }

    void (async () => {
      if (req.method === "OPTIONS") {
        res.statusCode = 204;
        res.setHeader("access-control-allow-methods", "POST, OPTIONS");
        res.setHeader(
          "access-control-allow-headers",
          "content-type, authorization",
        );
        res.end();
        return;
      }
      if (req.method !== "POST") {
        sendJson(res, 405, {
          ok: false,
          code: "BAD_REQUEST",
          message: "POST required",
        });
        return;
      }
      const apiKey = extractBearerToken(req.headers.authorization);
      if (!apiKey) {
        sendJson(res, 401, {
          ok: false,
          code: "UNAUTHORIZED",
          message: "Authorization Bearer token required",
        });
        return;
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
        return;
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
        return;
      }
      const parsed = parseAiChatProxyBody(parsedJson);
      if (!parsed.ok) {
        sendJson(res, 400, {
          ok: false,
          code: "BAD_REQUEST",
          message: parsed.message,
        });
        return;
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
        return;
      }
      sendJson(res, 200, result);
    })().catch(() => {
      sendJson(res, 500, {
        ok: false,
        code: "INTERNAL",
        message: "internal error",
      });
    });
  };
}

export function aiChatDevProxy(): Plugin {
  const middleware = createAiChatDevMiddleware();
  return {
    name: "blocksync-ai-chat-dev-proxy",
    configureServer(server) {
      server.middlewares.use(middleware);
    },
    configurePreviewServer(server) {
      server.middlewares.use(middleware);
    },
  };
}
