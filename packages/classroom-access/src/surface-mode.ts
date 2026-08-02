import {isPlausibleStudentToken} from "./tokens.js";
import type {SurfaceMode} from "./types.js";

function normalizeBasePath(basePath: string | undefined): string {
  if (!basePath || basePath === "/") return "";
  return basePath.endsWith("/") ? basePath.slice(0, -1) : basePath;
}

/**
 * Map a browser pathname to community / admin / student surface.
 * Account-slug multi-tenant paths are intentionally unsupported.
 */
export function resolveSurfaceMode(
  pathname: string,
  basePath = "/",
): SurfaceMode {
  const base = normalizeBasePath(basePath);
  let path = pathname.split("?")[0] ?? "/";
  if (base && path.startsWith(base)) {
    path = path.slice(base.length) || "/";
  }
  if (!path.startsWith("/")) path = `/${path}`;
  // Drop trailing slash except root.
  if (path.length > 1 && path.endsWith("/")) path = path.slice(0, -1);

  if (path === "/admin") return {kind: "admin"};

  if (path === "/s") return {kind: "student"};

  const studentMatch = /^\/s\/([^/]+)$/.exec(path);
  if (studentMatch) {
    const token = decodeURIComponent(studentMatch[1] ?? "");
    if (isPlausibleStudentToken(token)) {
      return {kind: "student", token};
    }
  }

  return {kind: "community"};
}
