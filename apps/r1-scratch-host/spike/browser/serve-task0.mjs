#!/usr/bin/env node
/**
 * Static server for Task 0 browser smoke (scratch-gui dist + spike fixtures).
 */
import http from "node:http";
import { readFileSync, existsSync } from "node:fs";
import { join, dirname, extname } from "node:path";
import { fileURLToPath } from "node:url";

const browserDir = join(dirname(fileURLToPath(import.meta.url)));
const repoRoot = join(browserDir, "../../../..");
const guiDist = join(repoRoot, "vendor/scratch-editor/packages/scratch-gui/dist");
const port = Number(process.env.TASK0_BROWSER_PORT ?? 8765);

const mime = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".wav": "audio/wav",
  ".map": "application/json",
};

function send(res, status, body, type = "text/plain; charset=utf-8") {
  res.writeHead(status, { "Content-Type": type });
  res.end(body);
}

function handler(req, res) {
  const url = new URL(req.url ?? "/", `http://127.0.0.1:${port}`);
  let filePath;
  if (url.pathname === "/" || url.pathname === "/index.html") {
    filePath = join(browserDir, "task0-host.html");
  } else if (url.pathname === "/task0-bootstrap.js") {
    filePath = join(browserDir, "task0-bootstrap.js");
  } else if (url.pathname.startsWith("/fixtures/")) {
    filePath = join(browserDir, "fixtures", url.pathname.slice("/fixtures/".length));
  } else if (url.pathname.startsWith("/gui/")) {
    filePath = join(guiDist, url.pathname.slice("/gui/".length));
  } else {
    return send(res, 404, "Not found");
  }

  if (!existsSync(filePath)) {
    return send(res, 404, `Missing ${filePath}`);
  }

  const ext = extname(filePath);
  return send(res, 200, readFileSync(filePath), mime[ext] ?? "application/octet-stream");
}

if (!existsSync(join(guiDist, "scratch-gui-standalone.js"))) {
  console.error("GUI dist missing — run pnpm gate0:build-vendor-gui-spike");
  process.exit(1);
}

http.createServer(handler).listen(port, "127.0.0.1", () => {
  console.log(`[task0-browser-serve] http://127.0.0.1:${port}/`);
});
