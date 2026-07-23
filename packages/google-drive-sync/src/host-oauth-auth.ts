/**
 * Browser GoogleAuthorization backed by collab-host authorization-code
 * + refresh-token sessions (HttpOnly cookie). Access tokens stay in memory.
 */
import {DriveAuthenticationError, DriveNetworkError} from "./errors.js";
import {
  DRIVE_OAUTH_LOGOUT_PATH,
  DRIVE_OAUTH_RETURN_FLAG,
  DRIVE_OAUTH_SESSION_PATH,
  DRIVE_OAUTH_START_PATH,
  DRIVE_OAUTH_STATUS_PATH,
} from "./oauth-paths.js";
import {
  createLocalDriveAuthPreferenceStore,
  type DriveAuthPreferenceStore,
  type GoogleAuthorization,
} from "./auth.js";

export interface HostOAuthSessionResponse {
  ok: true;
  accessToken: string;
  expiresAt: number;
}

export interface HostOAuthStatusResponse {
  ok: true;
  available: boolean;
}

export interface HostBackedGoogleAuthorizationOptions {
  preferenceStore?: DriveAuthPreferenceStore;
  fetch?: typeof fetch;
  locate?: () => Location;
  /** Assign location for OAuth start redirect (tests inject). */
  assignUrl?: (url: string) => void;
  startPath?: string;
  sessionPath?: string;
  logoutPath?: string;
  statusPath?: string;
}

function defaultAssignUrl(url: string): void {
  window.location.assign(url);
}

export async function probeHostDriveOAuthAvailable(
  options: {
    fetch?: typeof fetch;
    statusPath?: string;
  } = {},
): Promise<boolean> {
  const fetchImpl = options.fetch ?? fetch;
  const statusPath = options.statusPath ?? DRIVE_OAUTH_STATUS_PATH;
  try {
    const response = await fetchImpl(statusPath, {
      method: "GET",
      credentials: "same-origin",
      headers: {accept: "application/json"},
    });
    if (!response.ok) return false;
    const body = (await response.json()) as HostOAuthStatusResponse;
    return body.ok === true && body.available === true;
  } catch {
    return false;
  }
}

export function createHostBackedGoogleAuthorization(
  options: HostBackedGoogleAuthorizationOptions = {},
): GoogleAuthorization {
  let accessToken: string | null = null;
  let accessExpiresAt = 0;
  let connectPromise: Promise<string> | null = null;
  let generation = 0;
  const preference =
    options.preferenceStore ?? createLocalDriveAuthPreferenceStore();
  const fetchImpl = options.fetch ?? fetch;
  const locate = options.locate ?? (() => window.location);
  const assignUrl = options.assignUrl ?? defaultAssignUrl;
  const startPath = options.startPath ?? DRIVE_OAUTH_START_PATH;
  const sessionPath = options.sessionPath ?? DRIVE_OAUTH_SESSION_PATH;
  const logoutPath = options.logoutPath ?? DRIVE_OAUTH_LOGOUT_PATH;

  async function loadSession(): Promise<string> {
    const response = await fetchImpl(sessionPath, {
      method: "GET",
      credentials: "same-origin",
      headers: {accept: "application/json"},
    });
    if (response.status === 401 || response.status === 404) {
      preference.setEnabled(false);
      accessToken = null;
      accessExpiresAt = 0;
      throw new DriveAuthenticationError("Google Drive session is not active");
    }
    if (!response.ok) {
      throw new DriveNetworkError(
        `Google Drive session request failed (${response.status})`,
      );
    }
    const body = (await response.json()) as HostOAuthSessionResponse;
    if (!body?.ok || !body.accessToken) {
      preference.setEnabled(false);
      throw new DriveAuthenticationError("Google Drive session response invalid");
    }
    accessToken = body.accessToken;
    accessExpiresAt = Number(body.expiresAt) || 0;
    preference.setEnabled(true);
    return accessToken;
  }

  return {
    canRestoreSession() {
      return preference.isEnabled() && accessToken === null;
    },
    async connect() {
      if (connectPromise) return connectPromise;
      const connectGeneration = generation;
      connectPromise = (async () => {
        // After OAuth redirect, or when a cookie session already exists.
        try {
          const token = await loadSession();
          if (generation !== connectGeneration) {
            throw new DriveAuthenticationError(
              "Google authorization was cancelled",
            );
          }
          return token;
        } catch (error) {
          if (!(error instanceof DriveAuthenticationError)) throw error;
        }

        const location = locate();
        const returnTo = `${location.pathname}${location.search}${location.hash}`;
        const url = new URL(startPath, location.origin);
        url.searchParams.set("return", returnTo || "/");
        assignUrl(url.toString());
        // Navigation away — never resolves in the real browser.
        return new Promise<string>(() => undefined);
      })().finally(() => {
        connectPromise = null;
      });
      return connectPromise;
    },
    disconnect() {
      generation += 1;
      accessToken = null;
      accessExpiresAt = 0;
      preference.setEnabled(false);
      void fetchImpl(logoutPath, {
        method: "POST",
        credentials: "same-origin",
      }).catch(() => undefined);
    },
    getAccessToken() {
      return accessToken;
    },
    async ensureAccessToken() {
      if (accessToken && Date.now() < accessExpiresAt - 60_000) {
        return accessToken;
      }
      try {
        return await loadSession();
      } catch {
        return null;
      }
    },
  };
}

/** Strip OAuth return flag from the current URL without reloading. */
export function consumeDriveOAuthReturnFlag(
  locate: () => Location = () => window.location,
  replaceUrl: (url: string) => void = url =>
    window.history.replaceState({}, "", url),
): boolean {
  const location = locate();
  const url = new URL(location.href);
  if (!url.searchParams.has(DRIVE_OAUTH_RETURN_FLAG)) return false;
  url.searchParams.delete(DRIVE_OAUTH_RETURN_FLAG);
  const next = `${url.pathname}${url.search}${url.hash}`;
  replaceUrl(next);
  return true;
}
