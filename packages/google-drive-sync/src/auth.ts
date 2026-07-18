import {
  DriveAuthenticationError,
  DriveConfigurationError,
  DriveNetworkError,
} from "./errors.js";

export const DRIVE_FILE_SCOPE =
  "https://www.googleapis.com/auth/drive.file";

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

export interface GoogleAuthorization {
  connect(): Promise<string>;
  disconnect(): void;
  getAccessToken(): string | null;
}

export interface GoogleAuthorizationOptions {
  clientId: string;
  loadScripts: () => Promise<void>;
  getGoogle: () => GoogleIdentityGlobal | undefined;
}

export function createGoogleAuthorization(
  options: GoogleAuthorizationOptions,
): GoogleAuthorization {
  let accessToken: string | null = null;

  return {
    async connect() {
      if (!options.clientId) {
        throw new DriveConfigurationError("Google client ID is not configured");
      }
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
            if (!response.access_token || response.error) {
              reject(new DriveAuthenticationError(
                response.error_description ??
                  response.error ??
                  "Google authorization failed",
              ));
              return;
            }
            accessToken = response.access_token;
            resolve(accessToken);
          },
          error_callback(error) {
            reject(new DriveAuthenticationError(
              "Google authorization dialog failed",
              {cause: error},
            ));
          },
        });
        client.requestAccessToken({prompt: accessToken ? "" : "consent"});
      });
    },
    disconnect() {
      if (accessToken) {
        options.getGoogle()?.accounts.oauth2.revoke?.(accessToken);
      }
      accessToken = null;
    },
    getAccessToken() {
      return accessToken;
    },
  };
}
