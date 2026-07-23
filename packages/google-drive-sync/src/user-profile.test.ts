import {describe, expect, it, vi} from "vitest";
import {fetchGoogleUserProfile} from "./user-profile.js";

describe("fetchGoogleUserProfile", () => {
  it("returns picture/name from userinfo", async () => {
    const fetchImpl = vi.fn(async () =>
      new Response(
        JSON.stringify({
          sub: "123",
          name: "Ada",
          picture: "https://lh3.googleusercontent.com/a/ada",
        }),
        {status: 200, headers: {"content-type": "application/json"}},
      ),
    );
    await expect(fetchGoogleUserProfile("tok", fetchImpl)).resolves.toEqual({
      sub: "123",
      name: "Ada",
      picture: "https://lh3.googleusercontent.com/a/ada",
    });
    expect(fetchImpl).toHaveBeenCalledWith(
      "https://www.googleapis.com/oauth2/v3/userinfo",
      expect.objectContaining({
        headers: expect.objectContaining({
          authorization: "Bearer tok",
        }),
      }),
    );
  });

  it("returns null on auth failure or empty body", async () => {
    await expect(
      fetchGoogleUserProfile(
        "tok",
        vi.fn(async () => new Response("nope", {status: 401})),
      ),
    ).resolves.toBeNull();
    await expect(fetchGoogleUserProfile("")).resolves.toBeNull();
  });
});
