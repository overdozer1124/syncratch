/**
 * Minimal static file server for the editor-web Vite build.
 * Serves files under STATIC_ROOT and falls back to index.html for GET navigations.
 * Large compressible assets are gzipped when Accept-Encoding includes gzip.
 */
import {createReadStream, existsSync, statSync} from "node:fs";
import type {IncomingMessage, ServerResponse} from "node:http";
import {extname, join, normalize, sep} from "node:path";
import {createGzip} from "node:zlib";

const MIME_BY_EXT: Record<string, string> = {
  ".css": "text/css; charset=utf-8",
  ".gif": "image/gif",
  ".html": "text/html; charset=utf-8",
  ".ico": "image/x-icon",
  ".jpeg": "image/jpeg",
  ".jpg": "image/jpeg",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".map": "application/json; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".txt": "text/plain; charset=utf-8",
  ".wasm": "application/wasm",
  ".webp": "image/webp",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
};

const GZIP_EXT = new Set([
  ".css",
  ".html",
  ".js",
  ".json",
  ".map",
  ".mjs",
  ".svg",
  ".txt",
  ".wasm",
]);

const GZIP_MIN_BYTES = 16 * 1024;

export function contentTypeFor(filePath: string): string {
  return MIME_BY_EXT[extname(filePath).toLowerCase()] ?? "application/octet-stream";
}

export function resolveSafePath(rootDir: string, urlPath: string): string | null {
  const decoded = decodeURIComponent(urlPath.split("?")[0] ?? "/");
  const relative = decoded === "/" ? "index.html" : decoded.replace(/^\/+/, "");
  const candidate = normalize(join(rootDir, relative));
  const rootWithSep = rootDir.endsWith(sep) ? rootDir : `${rootDir}${sep}`;
  if (candidate !== rootDir && !candidate.startsWith(rootWithSep)) {
    return null;
  }
  return candidate;
}

export function wantsGzip(acceptEncoding: string | string[] | undefined): boolean {
  const value = Array.isArray(acceptEncoding)
    ? acceptEncoding.join(",")
    : (acceptEncoding ?? "");
  return /\bgzip\b/i.test(value);
}

export function shouldGzipFile(filePath: string, size: number): boolean {
  return size >= GZIP_MIN_BYTES && GZIP_EXT.has(extname(filePath).toLowerCase());
}

export function createStaticRequestHandler(rootDir: string) {
  return function handleStatic(
    req: IncomingMessage,
    res: ServerResponse,
  ): boolean {
    const method = req.method ?? "GET";
    if (method !== "GET" && method !== "HEAD") {
      return false;
    }
    const urlPath = req.url ?? "/";
    if (urlPath === "/healthz") {
      res.writeHead(200, {"content-type": "text/plain; charset=utf-8"});
      res.end(method === "HEAD" ? undefined : "ok");
      return true;
    }

    let filePath = resolveSafePath(rootDir, urlPath);
    if (!filePath) {
      res.writeHead(400, {"content-type": "text/plain; charset=utf-8"});
      res.end(method === "HEAD" ? undefined : "bad path");
      return true;
    }

    if (!existsSync(filePath) || !statSync(filePath).isFile()) {
      // SPA fallback for navigations without an extension (invite hash is client-side).
      const looksLikeAsset = Boolean(extname(urlPath.split("?")[0] ?? ""));
      if (looksLikeAsset) {
        res.writeHead(404, {"content-type": "text/plain; charset=utf-8"});
        res.end(method === "HEAD" ? undefined : "not found");
        return true;
      }
      filePath = join(rootDir, "index.html");
      if (!existsSync(filePath)) {
        res.writeHead(404, {"content-type": "text/plain; charset=utf-8"});
        res.end(method === "HEAD" ? undefined : "not found");
        return true;
      }
    }

    const type = contentTypeFor(filePath);
    const size = statSync(filePath).size;
    const useGzip = wantsGzip(req.headers["accept-encoding"]) &&
      shouldGzipFile(filePath, size);
    const cacheControl =
      filePath.endsWith("index.html") ? "no-cache" : "public, max-age=3600";

    if (useGzip) {
      res.writeHead(200, {
        "content-type": type,
        "content-encoding": "gzip",
        vary: "Accept-Encoding",
        "cache-control": cacheControl,
      });
      if (method === "HEAD") {
        res.end();
        return true;
      }
      createReadStream(filePath).pipe(createGzip()).pipe(res);
      return true;
    }

    res.writeHead(200, {
      "content-type": type,
      "content-length": size,
      "cache-control": cacheControl,
    });
    if (method === "HEAD") {
      res.end();
      return true;
    }
    createReadStream(filePath).pipe(res);
    return true;
  };
}
