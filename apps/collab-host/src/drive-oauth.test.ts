import {describe, expect, it, vi} from "vitest";
import {
  DRIVE_OAUTH_CALLBACK_PATH,
  DRIVE_OAUTH_SESSION_PATH,
  DRIVE_OAUTH_START_PATH,
  DRIVE_OAUTH_STATUS_PATH,
} from "@blocksync/google-drive-sync";
import {
  createDriveOAuthHandler,
  createMemoryDriveOAuthStore,
  readDriveOAuthConfigFromEnv,
  type DriveOAuthConfig,
} from "./drive-oauth.js";
import type {IncomingMessage, ServerResponse} from "node:http";

function mockRes() {
  const headers = new Map<string, string | number | string[]>();
  let statusCode = 0;
  let body = "";
  const res = {
    writeHead(status: number, hdrs?: Record<string, string>) {
      statusCode = status;
      if (hdrs) {
        for (const [key, value] of Object.entries(hdrs)) {
          headers.set(key.toLowerCase(), value);
        }
      }
      return res;
    },
    setHeader(name: string, value: string | string[]) {
      headers.set(name.toLowerCase(), value);
    },
    getHeader(name: string) {
      return headers.get(name.toLowerCase());
    },
    end(chunk?: string) {
      body = chunk ?? "";
    },
  } as unknown as ServerResponse;
  return {
    res,
    get status() {
      return statusCode;
    },
    get body() {
      return body;
    },
    get headers() {
      return headers;
    },
  };
}

function mockReq(
  url: string,
  options: {method?: string; headers?: Record<string, string>} = {},
): IncomingMessage {
  return {
    url,
    method: options.method ?? "GET",
    headers: options.headers ?? {host: "localhost:8080"},
  } as IncomingMessage;
}

describe("readDriveOAuthConfigFromEnv", () => {
  it("requires client id and secret", () => {
    expect(readDriveOAuthConfigFromEnv({})).toBeNull();
    expect(
      readDriveOAuthConfigFromEnv({
        GOOGLE_CLIENT_ID: "id",
        GOOGLE_CLIENT_SECRET: "secret",
      }),
    ).toMatchObject({clientId: "id", clientSecret: "secret"});
  });
});

describe("drive oauth handler", () => {
  it("reports unavailable when config is missing", async () => {
    const handle = createDriveOAuthHandler({config: null});
    const out = mockRes();
    expect(await handle(mockReq(DRIVE_OAUTH_STATUS_PATH), out.res)).toBe(true);
    expect(out.status).toBe(200);
    expect(JSON.parse(out.body)).toEqual({ok: true, available: false});
  });

  it("starts authorize redirect with offline access and PKCE", async () => {
    const config: DriveOAuthConfig = {
      clientId: "client",
      clientSecret: "secret",
      redirectUri: "http://localhost:8080/oauth/google/callback",
      cookieSecure: false,
    };
    const handle = createDriveOAuthHandler({
      config,
      store: createMemoryDriveOAuthStore(),
    });
    const out = mockRes();
    expect(
      await handle(
        mockReq(`${DRIVE_OAUTH_START_PATH}?return=/editor`),
        out.res,
      ),
    ).toBe(true);
    expect(out.status).toBe(302);
    const location = String(out.headers.get("location"));
    const url = new URL(location);
    expect(url.origin).toBe("https://accounts.google.com");
    expect(url.searchParams.get("access_type")).toBe("offline");
    expect(url.searchParams.get("prompt")).toBe("consent");
    expect(url.searchParams.get("code_challenge_method")).toBe("S256");
    expect(url.searchParams.get("code_challenge")).toBeTruthy();
    expect(url.searchParams.get("state")).toBeTruthy();
  });

  it("exchanges code, sets session cookie, and serves refreshed access tokens", async () => {
    const store = createMemoryDriveOAuthStore();
    const fetchImpl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.includes("/token")) {
        const body = String(init?.body ?? "");
        if (body.includes("grant_type=authorization_code")) {
          return new Response(
            JSON.stringify({
              access_token: "access-1",
              refresh_token: "refresh-1",
              expires_in: 3600,
            }),
            {status: 200, headers: {"content-type": "application/json"}},
          );
        }
        if (body.includes("grant_type=refresh_token")) {
          return new Response(
            JSON.stringify({
              access_token: "access-2",
              expires_in: 3600,
            }),
            {status: 200, headers: {"content-type": "application/json"}},
          );
        }
      }
      return new Response("{}", {status: 500});
    });
    const config: DriveOAuthConfig = {
      clientId: "client",
      clientSecret: "secret",
      redirectUri: "http://localhost:8080/oauth/google/callback",
      cookieSecure: false,
      fetch: fetchImpl as unknown as typeof fetch,
      now: () => 1_000_000,
    };
    const handle = createDriveOAuthHandler({config, store});

    const startOut = mockRes();
    await handle(mockReq(`${DRIVE_OAUTH_START_PATH}?return=/`), startOut.res);
    const startLocation = new URL(String(startOut.headers.get("location")));
    const state = startLocation.searchParams.get("state");
    expect(state).toBeTruthy();

    const callbackOut = mockRes();
    await handle(
      mockReq(
        `${DRIVE_OAUTH_CALLBACK_PATH}?code=abc&state=${encodeURIComponent(state!)}`,
      ),
      callbackOut.res,
    );
    expect(callbackOut.status).toBe(302);
    const setCookie = callbackOut.headers.get("set-cookie");
    expect(String(setCookie)).toContain("syncratch_drive_session=");

    const cookieHeader = String(Array.isArray(setCookie) ? setCookie[0] : setCookie)
      .split(";")[0]!;

    // Force access token expiry so the session endpoint refreshes.
    const sessionId = decodeURIComponent(cookieHeader.split("=")[1]!);
    const record = store.getSession(sessionId);
    expect(record).toBeTruthy();
    record!.accessExpiresAt = 0;
    store.putSession(sessionId, record!);

    const sessionOut = mockRes();
    await handle(
      mockReq(DRIVE_OAUTH_SESSION_PATH, {
        headers: {host: "localhost:8080", cookie: cookieHeader},
      }),
      sessionOut.res,
    );
    expect(sessionOut.status).toBe(200);
    expect(JSON.parse(sessionOut.body)).toMatchObject({
      ok: true,
      accessToken: "access-2",
    });
  });
});
