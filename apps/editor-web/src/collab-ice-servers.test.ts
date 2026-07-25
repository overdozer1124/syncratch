import {describe, expect, it} from "vitest";
import {parseCollabIceServers} from "./collab-ice-servers.js";

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
