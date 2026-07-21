import type {Connect} from "vite";
import {createReadStream, existsSync, statSync} from "node:fs";
import {join, extname} from "node:path";
import {createGzip} from "node:zlib";
import {pipeline} from "node:stream";

const COMPRESSIBLE = new Set([
  ".js",
  ".css",
  ".wasm",
  ".svg",
  ".json",
  ".map",
  ".txt",
  ".html",
]);

const CONTENT_TYPES: Record<string, string> = {
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".wasm": "application/wasm",
  ".svg": "image/svg+xml",
  ".json": "application/json; charset=utf-8",
  ".map": "application/json; charset=utf-8",
  ".txt": "text/plain; charset=utf-8",
  ".html": "text/html; charset=utf-8",
};

/** Compress large public assets when the client accepts gzip. */
export function createGzipStaticMiddleware(
  publicDir: string,
  options: {minBytes?: number} = {},
): Connect.NextHandleFunction {
  const minBytes = options.minBytes ?? 16 * 1024;

  return (req, res, next) => {
    if (req.method !== "GET" && req.method !== "HEAD") {
      next();
      return;
    }
    const accept = req.headers["accept-encoding"];
    if (typeof accept !== "string" || !/\bgzip\b/i.test(accept)) {
      next();
      return;
    }
    const urlPath = req.url?.split("?")[0] ?? "";
    if (urlPath.includes("..")) {
      next();
      return;
    }
    const ext = extname(urlPath).toLowerCase();
    if (!COMPRESSIBLE.has(ext)) {
      next();
      return;
    }

    const relative = decodeURIComponent(urlPath.replace(/^\//, ""));
    const filePath = join(publicDir, relative);
    if (!filePath.startsWith(publicDir) || !existsSync(filePath)) {
      next();
      return;
    }
    const stats = statSync(filePath);
    if (!stats.isFile() || stats.size < minBytes) {
      next();
      return;
    }

    res.setHeader("Content-Type", CONTENT_TYPES[ext] ?? "application/octet-stream");
    res.setHeader("Content-Encoding", "gzip");
    res.setHeader("Vary", "Accept-Encoding");
    res.setHeader("Cache-Control", "public, max-age=86400, immutable");
    // Length is unknown after gzip; omit Content-Length.
    res.removeHeader("Content-Length");

    if (req.method === "HEAD") {
      res.end();
      return;
    }

    pipeline(createReadStream(filePath), createGzip({level: 6}), res, error => {
      if (error && !res.writableEnded) {
        next(error);
      }
    });
  };
}

export function shouldGzipStaticAsset(
  urlPath: string,
  acceptEncoding: string | undefined,
  byteLength: number,
  minBytes = 16 * 1024,
): boolean {
  if (typeof acceptEncoding !== "string" || !/\bgzip\b/i.test(acceptEncoding)) {
    return false;
  }
  if (byteLength < minBytes) return false;
  return COMPRESSIBLE.has(extname(urlPath).toLowerCase());
}
