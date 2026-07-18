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
  driveFileId: "1AbCdEfGhIjKlMnOpQrStUvWxYz",
};

describe("createInvite", () => {
  it("derives room id and secret from an injected entropy source only", () => {
    const a = createInvite(sample.driveFileId, {randomBytes: fixedRandom(1)});
    const b = createInvite(sample.driveFileId, {randomBytes: fixedRandom(1)});
    expect(a).toEqual(b);
    expect(a.driveFileId).toBe(sample.driveFileId);
    expect(a.roomId.length).toBeGreaterThanOrEqual(16);
    expect(a.secret.length).toBeGreaterThanOrEqual(32);
  });

  it("produces different secrets for different entropy", () => {
    const a = createInvite(sample.driveFileId, {randomBytes: fixedRandom(1)});
    const b = createInvite(sample.driveFileId, {randomBytes: fixedRandom(200)});
    expect(a.secret).not.toBe(b.secret);
    expect(a.roomId).not.toBe(b.roomId);
  });

  it("rejects an empty drive file id", () => {
    expect(() => createInvite("", {randomBytes: fixedRandom(1)})).toThrow();
  });
});

describe("invitation fragment encoding", () => {
  it("round-trips through a URL fragment", () => {
    const fragment = encodeInviteFragment(sample);
    expect(decodeInviteFragment(fragment)).toEqual(sample);
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
    // Secret and file id must not appear before the fragment.
    const beforeHash = url.slice(0, url.indexOf("#"));
    expect(beforeHash).not.toContain(sample.secret);
    expect(beforeHash).not.toContain(sample.driveFileId);
    expect(parseInviteFromUrl(url)).toEqual(sample);
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

  it("never leaks the secret or drive file id into the topic", async () => {
    const topic = await deriveSignalingTopic(sample);
    expect(topic).not.toContain(sample.secret);
    expect(topic).not.toContain(sample.driveFileId);
    expect(topic).not.toContain(sample.roomId);
  });

  it("does not depend on the drive file id", async () => {
    const t1 = await deriveSignalingTopic(sample);
    const t2 = await deriveSignalingTopic({...sample, driveFileId: "other"});
    expect(t1).toBe(t2);
  });
});
