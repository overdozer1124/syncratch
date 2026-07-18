import {describe, expect, it} from "vitest";
import {
  deriveLeadershipEpoch,
  electLeader,
  isLeader,
  type LeaderParticipant,
} from "../src/index.js";

const ROOM = "room-abc";

function p(participantId: string, eligible = true): LeaderParticipant {
  return {participantId, eligible};
}

describe("electLeader", () => {
  it("chooses the lexicographically smallest eligible participant deterministically", () => {
    const forward = electLeader(ROOM, [p("charlie"), p("alice"), p("bob")]);
    const shuffled = electLeader(ROOM, [p("bob"), p("charlie"), p("alice")]);
    expect(forward?.leaderId).toBe("alice");
    expect(shuffled?.leaderId).toBe("alice");
    expect(forward).toEqual(shuffled);
  });

  it("ignores ineligible participants when choosing a leader", () => {
    const state = electLeader(ROOM, [
      p("aaa-unauthenticated", false),
      p("zzz-eligible", true),
    ]);
    expect(state?.leaderId).toBe("zzz-eligible");
    expect(state?.eligible).toEqual(["zzz-eligible"]);
  });

  it("returns null when nobody is eligible", () => {
    expect(electLeader(ROOM, [p("x", false), p("y", false)])).toBeNull();
    expect(electLeader(ROOM, [])).toBeNull();
  });

  it("deduplicates participant ids", () => {
    const state = electLeader(ROOM, [p("dup"), p("dup"), p("later")]);
    expect(state?.eligible).toEqual(["dup", "later"]);
  });
});

describe("deriveLeadershipEpoch", () => {
  it("is stable for identical inputs regardless of membership order", () => {
    const a = deriveLeadershipEpoch(ROOM, "alice", ["bob", "alice"]);
    const b = deriveLeadershipEpoch(ROOM, "alice", ["alice", "bob"]);
    expect(a).toBe(b);
    expect(a).not.toHaveLength(0);
  });

  it("changes when the leader changes", () => {
    const a = deriveLeadershipEpoch(ROOM, "alice", ["alice", "bob"]);
    const b = deriveLeadershipEpoch(ROOM, "bob", ["alice", "bob"]);
    expect(a).not.toBe(b);
  });

  it("changes when the eligible membership changes", () => {
    const a = deriveLeadershipEpoch(ROOM, "alice", ["alice", "bob"]);
    const b = deriveLeadershipEpoch(ROOM, "alice", ["alice", "bob", "carol"]);
    expect(a).not.toBe(b);
  });

  it("changes when the room id changes", () => {
    const a = deriveLeadershipEpoch(ROOM, "alice", ["alice", "bob"]);
    const b = deriveLeadershipEpoch("room-xyz", "alice", ["alice", "bob"]);
    expect(a).not.toBe(b);
  });

  it("is never the hardcoded epoch 0", () => {
    const epoch = deriveLeadershipEpoch(ROOM, "alice", ["alice"]);
    expect(epoch).not.toBe("0");
  });
});

describe("election attaches a derived epoch and identity check", () => {
  it("elects, derives an epoch, and re-elects on leader departure with a new epoch", () => {
    const first = electLeader(ROOM, [p("alice"), p("bob"), p("carol")]);
    expect(first?.leaderId).toBe("alice");
    expect(first?.epoch).toBe(
      deriveLeadershipEpoch(ROOM, "alice", ["alice", "bob", "carol"]),
    );
    expect(isLeader(first, "alice")).toBe(true);
    expect(isLeader(first, "bob")).toBe(false);

    const afterLeave = electLeader(ROOM, [p("bob"), p("carol")]);
    expect(afterLeave?.leaderId).toBe("bob");
    expect(afterLeave?.epoch).not.toBe(first?.epoch);
    expect(isLeader(afterLeave, "bob")).toBe(true);
  });

  it("isLeader is false for a null state", () => {
    expect(isLeader(null, "alice")).toBe(false);
  });
});
