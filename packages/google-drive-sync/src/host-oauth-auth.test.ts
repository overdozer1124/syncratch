import {describe, expect, it, vi} from "vitest";
import {
  consumeDriveOAuthReturnFlag,
  createHostBackedGoogleAuthorization,
  probeHostDriveOAuthAvailable,
} from "./host-oauth-auth.js";
import {DRIVE_OAUTH_RETURN_FLAG} from "./oauth-paths.js";

describe("host-backed Google authorization", () => {
  it("restores an access token from the host session endpoint", async () => {
    const fetchImpl = vi.fn(async () =>
      new Response(
        JSON.stringify({
          ok: true,
          accessToken: "host-access",
          expiresAt: Date.now() + 60_000,
        }),
        {status: 200},
      ),
    );
    const auth = createHostBackedGoogleAuthorization({
      fetch: fetchImpl as unknown as typeof fetch,
      preferenceStore: {
        isEnabled: () => true,
        setEnabled: vi.fn(),
      },
      assignUrl: vi.fn(),
    });
    await expect(auth.connect()).resolves.toBe("host-access");
    expect(auth.getAccessToken()).toBe("host-access");
    expect(fetchImpl).toHaveBeenCalled();
  });

  it("redirects to OAuth start when no session exists", async () => {
    const assignUrl = vi.fn();
    const fetchImpl = vi.fn(async () =>
      new Response(JSON.stringify({ok: false}), {status: 401}),
    );
    const auth = createHostBackedGoogleAuthorization({
      fetch: fetchImpl as unknown as typeof fetch,
      preferenceStore: {
        isEnabled: () => false,
        setEnabled: vi.fn(),
      },
      locate: () =>
        ({
          origin: "http://localhost:4173",
          pathname: "/",
          search: "",
          hash: "",
        }) as Location,
      assignUrl,
    });
    void auth.connect();
    await Promise.resolve();
    await Promise.resolve();
    expect(assignUrl).toHaveBeenCalledWith(
      expect.stringContaining("/oauth/google/start?return="),
    );
  });

  it("probes host availability", async () => {
    await expect(
      probeHostDriveOAuthAvailable({
        fetch: (async () =>
          new Response(JSON.stringify({ok: true, available: true}), {
            status: 200,
          })) as unknown as typeof fetch,
      }),
    ).resolves.toBe(true);
    await expect(
      probeHostDriveOAuthAvailable({
        fetch: (async () =>
          new Response(JSON.stringify({ok: true, available: false}), {
            status: 200,
          })) as unknown as typeof fetch,
      }),
    ).resolves.toBe(false);
  });

  it("consumes the oauth return flag from the URL", () => {
    const replaceUrl = vi.fn();
    const ok = consumeDriveOAuthReturnFlag(
      () =>
        ({
          href: `http://localhost/?${DRIVE_OAUTH_RETURN_FLAG}=ok#room`,
        }) as Location,
      replaceUrl,
    );
    expect(ok).toBe(true);
    expect(replaceUrl).toHaveBeenCalledWith("/#room");
  });
});
