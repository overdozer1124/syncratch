/**
 * @experimental Deterministic best-effort leader election for small rooms.
 *
 * Leadership is NOT distributed locking. It is a deterministic function over the
 * current eligible awareness membership so every peer computes the same leader
 * and the same leadership epoch without coordination. Only the leader performs
 * durable Drive snapshots; on partition or conflict callers must stop saving.
 */

export interface LeaderParticipant {
  /** Random per-session participant id (never a name/email/token). */
  participantId: string;
  /** True only for authenticated participants with verified Drive read access. */
  eligible: boolean;
}

export interface LeadershipState {
  leaderId: string;
  /** Sorted, de-duplicated eligible participant ids. */
  eligible: string[];
  /** Deterministic epoch derived from room id, leader, and eligible membership. */
  epoch: string;
}

function fnv1a(input: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i += 1) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, "0");
}

function sortedEligibleIds(participants: readonly LeaderParticipant[]): string[] {
  const ids = new Set<string>();
  for (const participant of participants) {
    if (
      participant.eligible &&
      typeof participant.participantId === "string" &&
      participant.participantId.length > 0
    ) {
      ids.add(participant.participantId);
    }
  }
  return [...ids].sort();
}

/**
 * Derive a leadership epoch from the room id, the leader participant id, and the
 * sorted eligible membership. Deterministic and independent of input ordering.
 */
export function deriveLeadershipEpoch(
  roomId: string,
  leaderId: string,
  eligible: readonly string[],
): string {
  const sorted = [...new Set(eligible)].sort();
  const canonical = JSON.stringify({
    v: 1,
    room: roomId,
    leader: leaderId,
    eligible: sorted,
  });
  return `e1-${fnv1a(canonical)}-${sorted.length}`;
}

/**
 * Elect the leader deterministically: the lexicographically smallest eligible
 * participant id. Returns null when nobody is eligible.
 */
export function electLeader(
  roomId: string,
  participants: readonly LeaderParticipant[],
): LeadershipState | null {
  const eligible = sortedEligibleIds(participants);
  const leaderId = eligible[0];
  if (leaderId === undefined) return null;
  return {
    leaderId,
    eligible,
    epoch: deriveLeadershipEpoch(roomId, leaderId, eligible),
  };
}

export function isLeader(
  state: LeadershipState | null,
  participantId: string,
): boolean {
  return state !== null && state.leaderId === participantId;
}
