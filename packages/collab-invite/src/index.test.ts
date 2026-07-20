import {describe, expect, it} from "vitest";
import {
  createInvite,
  decodeInviteFragment,
  deriveSignalingTopic,
  encodeInviteFragment,
  inviteUrl,
  parseInviteFromUrl,
  type CollabInvite,
} from "../src/index.js";

function fixedRandom(seed: number): (length: number) => Uint8Array {
  return (length: number) => {
    const out = new Uint8Array(length);
    for (let i = 0; i < length; i += 1) out[i] = (seed + i * 31) & 0xff;
    return out;
  };
}

const sample: CollabInvite = {
  roomId: "room-abc",
  secret: "s3cr3t-high-entropy-value",
};

function encodeLegacyFragment(invite: CollabInvite & {driveFileId: string}): string {
  const payload = JSON.stringify(invite);
  const bytes = new TextEncoder().encode(payload);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  const encoded = btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
  return `blocksync-collab=${encoded}`;
}

describe("createInvite", () => {
  it("derives room id and secret from an injected entropy source only", () => {
    const a = createInvite({randomBytes: fixedRandom(1)});
    const b = createInvite({randomBytes: fixedRandom(1)});
    expect(a).toEqual(b);
    expect(a).not.toHaveProperty("driveFileId");
    expect(a.roomId.length).toBeGreaterThanOrEqual(16);
    expect(a.secret.length).toBeGreaterThanOrEqual(32);
  });

  it("produces different secrets for different entropy", () => {
    const a = createInvite({randomBytes: fixedRandom(1)});
    const b = createInvite({randomBytes: fixedRandom(200)});
    expect(a.secret).not.toBe(b.secret);
    expect(a.roomId).not.toBe(b.roomId);
  });

  it("creates invites without a Drive file id", () => {
    const invite = createInvite({randomBytes: fixedRandom(3)});
    expect(Object.keys(invite).sort()).toEqual(["roomId", "secret"]);
  });
});

describe("invitation fragment encoding", () => {
  it("round-trips through a URL fragment without a Drive file id", () => {
    const fragment = encodeInviteFragment(sample);
    expect(decodeInviteFragment(fragment)).toEqual(sample);
    const json = new TextDecoder().decode(
      Uint8Array.from(
        atob(
          fragment
            .slice("blocksync-collab=".length)
            .replaceAll("-", "+")
            .replaceAll("_", "/"),
        ),
        c => c.charCodeAt(0),
      ),
    );
    expect(json).not.toContain("driveFileId");
  });

  it("tolerates a leading # on decode", () => {
    const fragment = encodeInviteFragment(sample);
    expect(decodeInviteFragment(`#${fragment}`)).toEqual(sample);
  });

  it("keeps invitation data in the fragment only, never the query", () => {
    const url = inviteUrl("https://editor.example/app", sample);
    const parsed = new URL(url);
    expect(parsed.search).toBe("");
    expect(parsed.hash.length).toBeGreaterThan(1);
    const beforeHash = url.slice(0, url.indexOf("#"));
    expect(beforeHash).not.toContain(sample.secret);
    expect(parseInviteFromUrl(url)).toEqual(sample);
  });

  it("strips driveFileId from legacy invite fragments", () => {
    const legacy = encodeLegacyFragment({
      ...sample,
      driveFileId: "1AbCdEfGhIjKlMnOpQrStUvWxYz",
    });
    expect(decodeInviteFragment(legacy)).toEqual(sample);
    expect(decodeInviteFragment(legacy)).not.toHaveProperty("driveFileId");
  });

  it("returns null for malformed or foreign fragments", () => {
    expect(decodeInviteFragment("")).toBeNull();
    expect(decodeInviteFragment("#other=1")).toBeNull();
    expect(decodeInviteFragment("blocksync-collab=not-base64!!")).toBeNull();
  });
});

describe("deriveSignalingTopic", () => {
  it("is stable for the same room id and secret", async () => {
    const t1 = await deriveSignalingTopic(sample);
    const t2 = await deriveSignalingTopic({...sample});
    expect(t1).toBe(t2);
    expect(t1.length).toBeGreaterThan(0);
  });

  it("changes when the secret changes (one-way, per-room)", async () => {
    const t1 = await deriveSignalingTopic(sample);
    const t2 = await deriveSignalingTopic({...sample, secret: "different"});
    expect(t1).not.toBe(t2);
  });

  it("changes when the room id changes", async () => {
    const t1 = await deriveSignalingTopic(sample);
    const t2 = await deriveSignalingTopic({...sample, roomId: "room-xyz"});
    expect(t1).not.toBe(t2);
  });

  it("never leaks the secret into the topic", async () => {
    const topic = await deriveSignalingTopic(sample);
    expect(topic).not.toContain(sample.secret);
    expect(topic).not.toContain(sample.roomId);
  });

  it("does not depend on a legacy drive file id", async () => {
    const t1 = await deriveSignalingTopic(sample);
    const t2 = await deriveSignalingTopic({...sample, driveFileId: "other"});
    expect(t1).toBe(t2);
  });
});
