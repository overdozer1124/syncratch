import {
  DriveAuthenticationError,
  DriveConfigurationError,
  DriveNetworkError,
} from "./errors.js";

export const DRIVE_FILE_SCOPE =
  "https://www.googleapis.com/auth/drive.file";

/** Non-secret preference only — never store access/refresh tokens here. */
export const DRIVE_AUTH_PREFERENCE_KEY = "blocksync.driveAuthorized";

const GOOGLE_SCRIPT_SOURCES = [
  "https://accounts.google.com/gsi/client",
  "https://apis.google.com/js/api.js",
] as const;

export interface GoogleScriptLoaderOptions {
  appendScript?: (source: string) => Promise<void>;
}

function appendDomScript(source: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const existing = document.querySelector<HTMLScriptElement>(
      `script[src="${source}"]`,
    );
    if (existing?.dataset.blocksyncLoaded === "true") {
      resolve();
      return;
    }
    const script = existing ?? document.createElement("script");
    script.src = source;
    script.async = true;
    script.defer = true;
    script.addEventListener("load", () => {
      script.dataset.blocksyncLoaded = "true";
      resolve();
    }, {once: true});
    script.addEventListener(
      "error",
      () => reject(new DriveNetworkError(`Failed to load ${source}`)),
      {once: true},
    );
    if (!existing) document.head.append(script);
  });
}

export function loadGoogleScripts(
  options: GoogleScriptLoaderOptions = {},
): () => Promise<void> {
  const appendScript = options.appendScript ?? appendDomScript;
  let pending: Promise<void> | undefined;
  return async () => {
    pending ??= (async () => {
      for (const source of GOOGLE_SCRIPT_SOURCES) {
        await appendScript(source);
      }
    })().catch(error => {
      pending = undefined;
      throw error;
    });
    await pending;
  };
}

export interface TokenResponse {
  access_token?: string;
  error?: string;
  error_description?: string;
}

export interface GoogleOAuth2 {
  initTokenClient(config: {
    client_id: string;
    scope: string;
    callback(response: TokenResponse): void;
    error_callback?(error: unknown): void;
  }): {
    requestAccessToken(options?: {prompt?: string}): void;
  };
  revoke?(accessToken: string, callback?: () => void): void;
}

export interface GoogleIdentityGlobal {
  accounts: {oauth2: GoogleOAuth2};
}

export interface DriveAuthPreferenceStore {
  isEnabled(): boolean;
  setEnabled(enabled: boolean): void;
}

export function createLocalDriveAuthPreferenceStore(
  storage: Pick<Storage, "getItem" | "setItem" | "removeItem"> = localStorage,
): DriveAuthPreferenceStore {
  return {
    isEnabled() {
      try {
        return storage.getItem(DRIVE_AUTH_PREFERENCE_KEY) === "1";
      } catch {
        return false;
      }
    },
    setEnabled(enabled) {
      try {
        if (enabled) storage.setItem(DRIVE_AUTH_PREFERENCE_KEY, "1");
        else storage.removeItem(DRIVE_AUTH_PREFERENCE_KEY);
      } catch {
        // Private mode / quota — restore simply becomes unavailable.
      }
    },
  };
}

export interface GoogleAuthorization {
  connect(): Promise<string>;
  disconnect(): void;
  getAccessToken(): string | null;
  canRestoreSession(): boolean;
  /**
   * Optional: refresh / reload an access token without a full reconnect UI.
   * Host-backed OAuth implements this via the HttpOnly session cookie.
   */
  ensureAccessToken?(): Promise<string | null>;
}

export interface GoogleAuthorizationOptions {
  clientId: string;
  loadScripts: () => Promise<void>;
  getGoogle: () => GoogleIdentityGlobal | undefined;
  preferenceStore?: DriveAuthPreferenceStore;
}

export function createGoogleAuthorization(
  options: GoogleAuthorizationOptions,
): GoogleAuthorization {
  let accessToken: string | null = null;
  let connectPromise: Promise<string> | null = null;
  let generation = 0;
  const preference =
    options.preferenceStore ?? createLocalDriveAuthPreferenceStore();

  return {
    canRestoreSession() {
      return preference.isEnabled() && accessToken === null;
    },
    async connect() {
      if (accessToken) return accessToken;
      if (connectPromise) return connectPromise;
      if (!options.clientId) {
        throw new DriveConfigurationError("Google client ID is not configured");
      }
      const connectGeneration = generation;
      connectPromise = (async () => {
        await options.loadScripts();
        const google = options.getGoogle();
        if (!google?.accounts?.oauth2) {
          throw new DriveConfigurationError(
            "Google Identity Services did not initialize",
          );
        }
        return new Promise<string>((resolve, reject) => {
          const client = google.accounts.oauth2.initTokenClient({
            client_id: options.clientId,
            scope: DRIVE_FILE_SCOPE,
            callback(response) {
              if (generation !== connectGeneration) {
                reject(new DriveAuthenticationError(
                  "Google authorization was cancelled",
                ));
                return;
              }
              if (!response.access_token || response.error) {
                preference.setEnabled(false);
                reject(new DriveAuthenticationError(
                  response.error_description ??
                    response.error ??
                    "Google authorization failed",
                ));
                return;
              }
              accessToken = response.access_token;
              preference.setEnabled(true);
              resolve(accessToken);
            },
            error_callback(error) {
              preference.setEnabled(false);
              reject(new DriveAuthenticationError(
                "Google authorization dialog failed",
                {cause: error},
              ));
            },
          });
          // Empty prompt: reuse prior browser grant without consent UI when
          // possible; Google still shows consent on first authorization.
          client.requestAccessToken({prompt: ""});
        });
      })().finally(() => {
        connectPromise = null;
      });
      return connectPromise;
    },
    disconnect() {
      generation += 1;
      if (accessToken) {
        options.getGoogle()?.accounts.oauth2.revoke?.(accessToken);
      }
      accessToken = null;
      preference.setEnabled(false);
    },
    getAccessToken() {
      return accessToken;
    },
    async ensureAccessToken() {
      if (accessToken) return accessToken;
      if (!preference.isEnabled()) return null;
      try {
        return await this.connect();
      } catch {
        return null;
      }
    },
  };
}
