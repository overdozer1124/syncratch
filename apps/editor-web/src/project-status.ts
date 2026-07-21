import type {LocalSaveState} from "./save-coordinator.js";
import type {EditorDriveStatus} from "./drive-integration.js";
import type {CollabState} from "./collab-session.js";

export interface ProjectStatusInput {
  local: LocalSaveState;
  drive: EditorDriveStatus;
  driveMessage?: string;
  collab: CollabState | null;
  collabIdleMessage?: string;
  fatalError?: string;
  localError?: string;
}

const localStatusText: Record<LocalSaveState, string> = {
  clean: "このパソコンに保存しました",
  dirty: "変更を保存します…",
  saving: "このパソコンに保存中…",
  error: "このパソコンに保存できませんでした",
  conflict: "もう一度保存してください",
};

const driveDetailText: Record<EditorDriveStatus, string | null> = {
  "not-configured": null,
  disconnected: "Google ドライブ：つながっていません",
  connected: "Google ドライブにつながりました",
  syncing: "Google ドライブに保存中…",
  synced: "Google ドライブにも保存しました",
  unsynced: "Google ドライブにはまだ保存していません",
  conflict: "Google ドライブの作品が別の場所で変わっています",
};

const bootstrapText: Partial<Record<CollabState["bootstrapPhase"], string>> = {
  "receiving-project": "作品を受け取り中…",
  "verifying-project": "作品を確認中…",
  "saving-local-copy": "受け取った作品をこのパソコンに保存中…",
  "stalled-project": "作品の受け取りが止まりました",
  "invalid-project": "このリンクの作品を開けませんでした",
  "local-save-failed": "受け取った作品をこのパソコンに保存できませんでした",
};

export function collaborationStatusText(state: CollabState): string {
  if (state.status === "disconnected") {
    return "友だちとのつながりが切れました";
  }
  if (state.status === "connecting") {
    return "友だちとつないでいます…";
  }
  if (state.signalingError) {
    return "つながりに失敗しました。もう一度つないでください";
  }
  if (state.status === "connected" && !state.joinedTopic) {
    return "友だちとつないでいます…";
  }
  // Guest joined an empty signaling room — host is not present yet.
  if (
    !state.createdThisRoom &&
    state.joinedTopic &&
    state.signalingPeerCount === 0 &&
    state.expectedAssets === 0 &&
    (state.bootstrapPhase === "receiving-project" ||
      state.bootstrapPhase === "stalled-project")
  ) {
    return "友だちの部屋が見つかりません。ホスト側の画面を開いたまま、もう一度つないでください";
  }
  const phaseText = bootstrapText[state.bootstrapPhase];
  if (phaseText) {
    const assetProgress =
      state.bootstrapPhase === "receiving-project" && state.expectedAssets > 0
        ? `（素材 ${state.verifiedAssets}/${state.expectedAssets}）`
        : "";
    return `${phaseText}${assetProgress}`;
  }
  const connected =
    state.peerCount === 0
      ? "友だちの参加を待っています"
      : `${state.peerCount}人といっしょに作っています`;
  return state.conflict
    ? `${connected} · Google ドライブへの保存を止めています`
    : connected;
}

function collabDetail(
  state: CollabState | null,
  idleMessage?: string,
): string | null {
  if (!state) {
    return idleMessage && idleMessage !== "ひとりで作っています"
      ? idleMessage
      : null;
  }
  return collaborationStatusText(state);
}

export function composeProjectStatus(input: ProjectStatusInput): {
  primary: string;
  details: string;
} {
  if (input.fatalError) {
    return {primary: "エラー", details: input.fatalError};
  }
  const primary = input.localError ?? localStatusText[input.local];
  const details = [
    input.driveMessage
      ? `${driveDetailText[input.drive] ?? "Google ドライブ"}：${input.driveMessage}`
      : driveDetailText[input.drive],
    collabDetail(input.collab, input.collabIdleMessage),
  ]
    .filter((part): part is string => Boolean(part))
    .join(" · ");
  return {primary, details};
}
