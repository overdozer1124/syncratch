/**
 * Same-origin collab host for Railway verification:
 * - GET /*  → apps/editor-web/dist static files
 * - POST /ai/chat → optional AI advice proxy (API key from client Authorization)
 * - WS /signal → @blocksync/collab-signaling
 *
 * No TURN. Project bytes never transit this process (WebRTC data channels only).
 * AI proxy never stores API keys and never touches Yjs / signaling traffic.
 */
import {createServer} from "node:http";
import {dirname, resolve} from "node:path";
import {fileURLToPath} from "node:url";
import {
  DEFAULT_SIGNALING_PATH,
  startSignalingServer,
} from "@blocksync/collab-signaling";
import {handleAiChatProxy} from "./ai-proxy.js";
import {createStaticRequestHandler} from "./static.js";

export interface StartCollabHostOptions {
  port?: number;
  host?: string;
  staticRoot?: string;
  signalingPath?: string;
}

export interface CollabHostHandle {
  port: number;
  url: string;
  signalingUrl: string;
  close: () => Promise<void>;
}

function defaultStaticRoot(): string {
  const here = dirname(fileURLToPath(import.meta.url));
  // apps/collab-host/src → ../../editor-web/dist
  return resolve(here, "../../editor-web/dist");
}

export async function startCollabHost(
  options: StartCollabHostOptions = {},
): Promise<CollabHostHandle> {
  const port = options.port ?? Number(process.env.PORT ?? 8080);
  const host = options.host ?? process.env.HOST ?? "0.0.0.0";
  const staticRoot =
    options.staticRoot ?? process.env.STATIC_ROOT ?? defaultStaticRoot();
  const signalingPath =
    options.signalingPath?.trim() ||
    process.env.SIGNALING_PATH?.trim() ||
    DEFAULT_SIGNALING_PATH;

  const handleStatic = createStaticRequestHandler(staticRoot);
  const httpServer = createServer((req, res) => {
    void (async () => {
      if (await handleAiChatProxy(req, res)) return;
      if (handleStatic(req, res)) return;
      res.writeHead(405, {"content-type": "text/plain; charset=utf-8"});
      res.end("method not allowed");
    })().catch(() => {
      if (!res.headersSent) {
        res.writeHead(500, {"content-type": "text/plain; charset=utf-8"});
      }
      res.end("internal error");
    });
  });

  await new Promise<void>((resolveListen, reject) => {
    httpServer.once("error", reject);
    httpServer.listen(port, host, () => resolveListen());
  });

  const signaling = await startSignalingServer({
    httpServer,
    path: signalingPath,
    host: "127.0.0.1",
  });

  const address = httpServer.address();
  const resolvedPort =
    typeof address === "object" && address ? address.port : port;
  const publicHost = host === "0.0.0.0" || host === "::" ? "127.0.0.1" : host;

  return {
    port: resolvedPort,
    url: `http://${publicHost}:${resolvedPort}/`,
    signalingUrl: signaling.url,
    close: async () => {
      await signaling.close();
      await new Promise<void>((resolveClose, reject) => {
        httpServer.close((err) => (err ? reject(err) : resolveClose()));
      });
    },
  };
}

function isExecutedDirectly(): boolean {
  const entry = process.argv[1];
  if (!entry) {
    return false;
  }
  try {
    return fileURLToPath(import.meta.url) === resolve(entry);
  } catch {
    return false;
  }
}

if (isExecutedDirectly()) {
  const handle = await startCollabHost();
  console.log(`[collab-host] static+signaling listening on ${handle.url}`);
  console.log(`[collab-host] signaling websocket ${handle.signalingUrl}`);
}
