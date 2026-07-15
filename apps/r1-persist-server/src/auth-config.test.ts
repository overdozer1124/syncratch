import { describe, expect, it } from "vitest";
import { assertAuthBootConfig } from "./auth-config.js";

function baseEnv(
  overrides: Record<string, string | undefined> = {},
): NodeJS.ProcessEnv {
  return {
    NODE_ENV: "development",
    R1_AUTH_MODE: "stub",
    R1_COOKIE_SECURE: "false",
    R1_ALLOWED_HOSTED_DOMAINS: "example.com",
    R1_ALLOWED_ORIGINS: "http://localhost:5173",
    ...overrides,
  };
}

describe("assertAuthBootConfig", () => {
  it("allows stub mode outside production", () => {
    const cfg = assertAuthBootConfig(baseEnv());
    expect(cfg.mode).toBe("stub");
    expect(cfg.cookieSecure).toBe(false);
    expect(cfg.allowedOrigins).toEqual(["http://localhost:5173"]);
  });

  it("refuses stub mode in production", () => {
    expect(() =>
      assertAuthBootConfig(
        baseEnv({ NODE_ENV: "production", R1_AUTH_MODE: "stub" }),
      ),
    ).toThrow(/stub|R1_AUTH_MODE/i);
  });

  it("refuses google mode with Secure cookies disabled outside allow-insecure", () => {
    expect(() =>
      assertAuthBootConfig(
        baseEnv({
          R1_AUTH_MODE: "google",
          R1_COOKIE_SECURE: "false",
          R1_GOOGLE_CLIENT_ID: "client.apps.googleusercontent.com",
        }),
      ),
    ).toThrow(/secure|cookie/i);
  });

  it("allows insecure cookies in test when R1_ALLOW_INSECURE_COOKIES=1", () => {
    const cfg = assertAuthBootConfig(
      baseEnv({
        NODE_ENV: "test",
        R1_AUTH_MODE: "google",
        R1_COOKIE_SECURE: "false",
        R1_ALLOW_INSECURE_COOKIES: "1",
        R1_GOOGLE_CLIENT_ID: "client.apps.googleusercontent.com",
      }),
    );
    expect(cfg.mode).toBe("google");
    expect(cfg.cookieSecure).toBe(false);
    expect(cfg.googleClientId).toBe("client.apps.googleusercontent.com");
  });

  it("refuses google mode with empty allowed origins", () => {
    expect(() =>
      assertAuthBootConfig(
        baseEnv({
          R1_AUTH_MODE: "google",
          R1_COOKIE_SECURE: "true",
          R1_ALLOWED_ORIGINS: "  ,  ",
          R1_GOOGLE_CLIENT_ID: "client.apps.googleusercontent.com",
        }),
      ),
    ).toThrow(/origin/i);
  });

  it("parses authorized parties comma list", () => {
    const cfg = assertAuthBootConfig(
      baseEnv({
        R1_AUTH_MODE: "google",
        R1_COOKIE_SECURE: "true",
        R1_GOOGLE_CLIENT_ID: "client.apps.googleusercontent.com",
        R1_GOOGLE_AUTHORIZED_PARTIES: " web.example , ,android.example ",
      }),
    );
    expect(cfg.googleAuthorizedParties).toEqual([
      "web.example",
      "android.example",
    ]);
  });

  it("defaults authorized parties to empty when unset", () => {
    const cfg = assertAuthBootConfig(
      baseEnv({
        R1_AUTH_MODE: "google",
        R1_COOKIE_SECURE: "true",
        R1_GOOGLE_CLIENT_ID: "client.apps.googleusercontent.com",
      }),
    );
    expect(cfg.googleAuthorizedParties).toEqual([]);
  });

  it("requires google client id in google mode", () => {
    expect(() =>
      assertAuthBootConfig(
        baseEnv({
          R1_AUTH_MODE: "google",
          R1_COOKIE_SECURE: "true",
          R1_GOOGLE_CLIENT_ID: "",
        }),
      ),
    ).toThrow(/client/i);
  });
});
