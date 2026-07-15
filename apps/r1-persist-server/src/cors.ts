import type { MiddlewareHandler } from "hono";
import { isOriginAllowed } from "./origin.js";

/**
 * Credentials CORS: allow-listed Origin gets exact ACAO + ACAC true + Vary: Origin.
 * Disallowed / missing Origin: do not emit ACAO/ACAC success headers.
 */
export function createCorsMiddleware(allowedOrigins: string[]): MiddlewareHandler {
  return async (c, next) => {
    const origin = c.req.header("origin");
    const allowed = isOriginAllowed(origin, allowedOrigins);

    if (c.req.method === "OPTIONS") {
      if (allowed && origin) {
        c.header("Access-Control-Allow-Origin", origin);
        c.header("Access-Control-Allow-Credentials", "true");
        c.header("Vary", "Origin");
        c.header(
          "Access-Control-Allow-Methods",
          "GET, POST, PUT, OPTIONS",
        );
        const reqHeaders = c.req.header("access-control-request-headers");
        if (reqHeaders) {
          c.header("Access-Control-Allow-Headers", reqHeaders);
        } else {
          c.header(
            "Access-Control-Allow-Headers",
            "Content-Type, X-CSRF-Token",
          );
        }
        c.header("Access-Control-Max-Age", "86400");
        return c.body(null, 204);
      }
      return c.body(null, 204);
    }

    await next();

    if (allowed && origin) {
      c.header("Access-Control-Allow-Origin", origin);
      c.header("Access-Control-Allow-Credentials", "true");
      c.header("Vary", "Origin");
    }
  };
}
