import {describe, expect, it} from "vitest";
import {
  createRoomCipher,
  decodeChannelMessage,
  encodeChannelMessage,
  FRAME_AWARENESS,
  FRAME_SYNC_STEP1,
  FRAME_UPDATE,
} from "./wire.js";

const SECRET = "high-entropy-room-secret-value-123456";

describe("createRoomCipher", () => {
  it("round-trips bytes with the same secret", async () => {
    const cipher = await createRoomCipher(SECRET);
    const plaintext = new Uint8Array([9, 8, 7, 6, 5]);
    const sealed = await cipher.seal(plaintext);
    const opened = await cipher.open(sealed);
    expect(Array.from(opened)).toEqual(Array.from(plaintext));
    // Ciphertext must not equal plaintext and must include a nonce.
    expect(sealed.byteLength).toBeGreaterThan(plaintext.byteLength);
  });

  it("fails to open with a different secret", async () => {
    const a = await createRoomCipher(SECRET);
    const b = await createRoomCipher("a-totally-different-secret-value-000");
    const sealed = await a.seal(new Uint8Array([1, 2, 3]));
    await expect(b.open(sealed)).rejects.toBeTruthy();
  });

  it("fails to open tampered ciphertext", async () => {
    const cipher = await createRoomCipher(SECRET);
    const sealed = await cipher.seal(new Uint8Array([1, 2, 3]));
    sealed[sealed.byteLength - 1] ^= 0xff;
    await expect(cipher.open(sealed)).rejects.toBeTruthy();
  });

  it("produces a distinct nonce per seal (non-deterministic ciphertext)", async () => {
    const cipher = await createRoomCipher(SECRET);
    const p = new Uint8Array([1, 2, 3]);
    const s1 = await cipher.seal(p);
    const s2 = await cipher.seal(p);
    expect(Array.from(s1)).not.toEqual(Array.from(s2));
  });
});

describe("channel message framing (encrypted)", () => {
  it("round-trips a sync-step1 frame through the cipher", async () => {
    const cipher = await createRoomCipher(SECRET);
    const sv = new Uint8Array([1, 2, 3, 4]);
    const wire = await encodeChannelMessage(cipher, {kind: FRAME_SYNC_STEP1, payload: sv});
    const decoded = await decodeChannelMessage(cipher, wire);
    expect(decoded.kind).toBe(FRAME_SYNC_STEP1);
    expect(Array.from(decoded.payload as Uint8Array)).toEqual([1, 2, 3, 4]);
  });

  it("round-trips an update frame", async () => {
    const cipher = await createRoomCipher(SECRET);
    const update = new Uint8Array([10, 20, 30]);
    const wire = await encodeChannelMessage(cipher, {kind: FRAME_UPDATE, payload: update});
    const decoded = await decodeChannelMessage(cipher, wire);
    expect(decoded.kind).toBe(FRAME_UPDATE);
    expect(Array.from(decoded.payload as Uint8Array)).toEqual([10, 20, 30]);
  });

  it("round-trips an awareness frame with a random participant id only", async () => {
    const cipher = await createRoomCipher(SECRET);
    const state = {participantId: "p-abc123", online: true};
    const wire = await encodeChannelMessage(cipher, {kind: FRAME_AWARENESS, payload: state});
    const decoded = await decodeChannelMessage(cipher, wire);
    expect(decoded.kind).toBe(FRAME_AWARENESS);
    expect(decoded.payload).toEqual(state);
  });

  it("cannot be decoded by a peer with the wrong secret", async () => {
    const good = await createRoomCipher(SECRET);
    const bad = await createRoomCipher("wrong-secret-wrong-secret-wrong-000");
    const wire = await encodeChannelMessage(good, {kind: FRAME_UPDATE, payload: new Uint8Array([1])});
    await expect(decodeChannelMessage(bad, wire)).rejects.toBeTruthy();
  });
});
