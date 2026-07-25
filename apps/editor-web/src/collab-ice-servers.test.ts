import {describe, expect, it, vi} from "vitest";
import {
  fetchHostIceServers,
  parseCollabIceServers,
  resolveCollabIceServers,
} from "./collab-ice-servers.js";

describe("parseCollabIceServers", () => {
  it("returns undefined for empty or invalid input", () => {
    expect(parseCollabIceServers(undefined)).toBeUndefined();
    expect(parseCollabIceServers("")).toBeUndefined();
    expect(parseCollabIceServers("not-json")).toBeUndefined();
    expect(parseCollabIceServers("[]")).toBeUndefined();
    expect(parseCollabIceServers("{}")).toBeUndefined();
  });

  it("parses a valid RTCIceServer array", () => {
    const servers = parseCollabIceServers(
      JSON.stringify([
        {urls: "stun:stun.example:3478"},
        {
          urls: ["turn:turn.example:80", "turns:turn.example:443"],
          username: "u",
          credential: "p",
        },
      ]),
    );
    expect(servers).toEqual([
      {urls: "stun:stun.example:3478"},
      {
        urls: ["turn:turn.example:80", "turns:turn.example:443"],
        username: "u",
        credential: "p",
      },
    ]);
  });
});

describe("resolveCollabIceServers", () => {
  it("prefers env override", async () => {
    const env = [{urls: "stun:custom"}];
    const servers = await resolveCollabIceServers({
      envIceServers: env,
      userId: "p-1",
      createOpenRelay: vi.fn(async () => [{urls: "stun:fallback"}]),
    });
    expect(servers).toEqual(env);
  });

  it("uses host /ice when available", async () => {
    const fetchImpl = vi.fn(async () =>
      new Response(
        JSON.stringify({
          iceServers: [
            {urls: "stun:stun.l.google.com:19302"},
            {
              urls: "turn:staticauth.openrelay.metered.ca:443",
              username: "1:p",
              credential: "x",
            },
          ],
        }),
        {status: 200, headers: {"content-type": "application/json"}},
      ),
    ) as unknown as typeof fetch;
    const servers = await resolveCollabIceServers({
      userId: "p-1",
      fetchImpl,
      origin: "https://example.test",
      createOpenRelay: vi.fn(async () => [{urls: "stun:fallback"}]),
    });
    expect(servers[1]).toMatchObject({
      urls: "turn:staticauth.openrelay.metered.ca:443",
      username: "1:p",
    });
  });

  it("falls back to client Open Relay minting", async () => {
    const mint = vi.fn(async () => [
      {urls: "stun:a"},
      {
        urls: ["turn:staticauth.openrelay.metered.ca:80"],
        username: "9:p-1",
        credential: "cred",
      },
    ]);
    const servers = await resolveCollabIceServers({
      userId: "p-1",
      fetchImpl: (async () => new Response("", {status: 404})) as typeof fetch,
      origin: "https://example.test",
      createOpenRelay: mint,
    });
    expect(mint).toHaveBeenCalledWith({userId: "p-1"});
    expect(servers[1]).toMatchObject({username: "9:p-1"});
  });
});

describe("fetchHostIceServers", () => {
  it("returns undefined when origin is empty", async () => {
    expect(await fetchHostIceServers(fetch, "")).toBeUndefined();
  });
});
