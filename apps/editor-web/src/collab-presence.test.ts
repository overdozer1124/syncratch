import {describe, expect, it} from "vitest";
import {
  buildCollabParticipants,
  fallbackDisplayName,
  readPresenceFields,
} from "./collab-presence.js";

describe("collab presence roster", () => {
  it("lists self first and connected peers with names/avatars", () => {
    const awareness = new Map<string, Record<string, unknown>>([
      [
        "p-guest",
        {
          participantId: "p-guest",
          displayName: "はなこ",
          avatarUrl: "https://example.com/hana.png",
        },
      ],
    ]);
    const rows = buildCollabParticipants({
      selfId: "p-host",
      selfCreatedRoom: true,
      selfDisplayName: "たろう",
      selfAvatarUrl: "https://example.com/taro.png",
      peers: ["p-guest"],
      awareness,
    });
    expect(rows).toEqual([
      {
        participantId: "p-host",
        displayName: "たろう",
        avatarUrl: "https://example.com/taro.png",
        isSelf: true,
        isRoomHost: true,
      },
      {
        participantId: "p-guest",
        displayName: "はなこ",
        avatarUrl: "https://example.com/hana.png",
        isSelf: false,
        isRoomHost: false,
      },
    ]);
  });

  it("falls back when peers have no Google profile", () => {
    expect(
      fallbackDisplayName({
        isSelf: false,
        isRoomHost: false,
        participantId: "p-abcd1234",
      }),
    ).toBe("ゲスト abcd");
    expect(readPresenceFields({roomHost: true}).roomHost).toBe(true);
    const rows = buildCollabParticipants({
      selfId: "p-guest",
      selfCreatedRoom: false,
      peers: ["p-host"],
      awareness: new Map([
        ["p-host", {participantId: "p-host", roomHost: true}],
      ]),
    });
    expect(rows[0]?.displayName).toBe("ゲスト（じぶん）");
    expect(rows[1]).toMatchObject({
      participantId: "p-host",
      displayName: "ホスト",
      isRoomHost: true,
    });
  });
});
