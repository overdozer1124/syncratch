/**
 * Room-local collab presence helpers (display name + optional avatar URL).
 * Shared over awareness only — never persisted into the project Y.Doc.
 */

export interface CollabParticipantPresence {
  participantId: string;
  displayName: string;
  avatarUrl?: string;
  isSelf: boolean;
  /** Room creator (invite host), not Yjs leadership. */
  isRoomHost: boolean;
}

export interface CollabPresenceFields {
  displayName?: string;
  avatarUrl?: string;
  /** Advertised by the peer that created the room. */
  roomHost?: boolean;
}

function asOptionalString(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

export function fallbackDisplayName(params: {
  isSelf: boolean;
  isRoomHost: boolean;
  participantId: string;
}): string {
  if (params.isRoomHost) return params.isSelf ? "ホスト（じぶん）" : "ホスト";
  if (params.isSelf) return "ゲスト（じぶん）";
  const short = params.participantId.replace(/^p-/, "").slice(0, 4);
  return short ? `ゲスト ${short}` : "ゲスト";
}

export function readPresenceFields(
  state: Record<string, unknown> | undefined,
): CollabPresenceFields {
  if (!state) return {};
  return {
    displayName: asOptionalString(state.displayName),
    avatarUrl: asOptionalString(state.avatarUrl),
    roomHost: state.roomHost === true,
  };
}

/**
 * Build a stable roster: self first, then connected peers by participant id.
 * Only peers with an open data channel (or self) are listed.
 */
export function buildCollabParticipants(input: {
  selfId: string;
  selfCreatedRoom: boolean;
  selfDisplayName?: string;
  selfAvatarUrl?: string;
  /** Open data-channel peer ids. */
  peers: readonly string[];
  awareness: ReadonlyMap<string, Record<string, unknown>>;
}): CollabParticipantPresence[] {
  const rows: CollabParticipantPresence[] = [];

  const selfHost = input.selfCreatedRoom;
  rows.push({
    participantId: input.selfId,
    displayName:
      input.selfDisplayName?.trim() ||
      fallbackDisplayName({
        isSelf: true,
        isRoomHost: selfHost,
        participantId: input.selfId,
      }),
    avatarUrl: input.selfAvatarUrl,
    isSelf: true,
    isRoomHost: selfHost,
  });

  const peerIds = [...input.peers].sort((a, b) => a.localeCompare(b));
  for (const peerId of peerIds) {
    if (peerId === input.selfId) continue;
    const raw = input.awareness.get(peerId);
    const fields = readPresenceFields(raw);
    const isRoomHost = fields.roomHost === true;
    rows.push({
      participantId: peerId,
      displayName:
        fields.displayName ||
        fallbackDisplayName({
          isSelf: false,
          isRoomHost,
          participantId: peerId,
        }),
      avatarUrl: fields.avatarUrl,
      isSelf: false,
      isRoomHost,
    });
  }

  return rows;
}
