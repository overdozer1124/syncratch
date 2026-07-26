/**
 * Renders the execution trace as a plain "what happened, in order" list.
 *
 * Formatting lives in pure functions so the wording is unit-testable without a
 * DOM, and so the same strings can later be reused for the AI context.
 */

import type {ResolvedTraceEntry} from "./execution-trace.js";

/**
 * Japanese labels for the opcodes learners meet first. Anything missing falls
 * back to the raw opcode: showing `sensing_touchingobject` is more useful than
 * hiding the step, and it keeps this map from pretending to be exhaustive.
 */
const OPCODE_LABELS_JA: Record<string, string> = {
  event_whenflagclicked: "緑の旗が押された",
  event_whenkeypressed: "キーが押された",
  event_whenthisspriteclicked: "スプライトがクリックされた",
  event_whenbroadcastreceived: "メッセージを受け取った",
  event_broadcast: "メッセージを送った",
  event_broadcastandwait: "メッセージを送って待った",
  control_wait: "待った",
  control_repeat: "繰り返した",
  control_forever: "ずっと繰り返した",
  control_if: "もし〜なら",
  control_if_else: "もし〜でなければ",
  control_stop: "止めた",
  control_create_clone_of: "クローンを作った",
  control_delete_this_clone: "クローンを削除した",
  motion_movesteps: "歩いた",
  motion_turnright: "右に回った",
  motion_turnleft: "左に回った",
  motion_gotoxy: "座標へ行った",
  motion_changexby: "x座標を変えた",
  motion_changeyby: "y座標を変えた",
  motion_setx: "x座標を決めた",
  motion_sety: "y座標を決めた",
  motion_ifonedgebounce: "端で跳ね返った",
  looks_say: "言った",
  looks_sayforsecs: "少しの間言った",
  looks_think: "考えた",
  looks_switchcostumeto: "コスチュームを変えた",
  looks_nextcostume: "次のコスチュームにした",
  looks_show: "表示した",
  looks_hide: "隠した",
  looks_changesizeby: "大きさを変えた",
  sound_play: "音を鳴らした",
  sound_playuntildone: "音を鳴らし終わるまで待った",
  data_setvariableto: "変数を決めた",
  data_changevariableby: "変数を変えた",
  data_addtolist: "リストに追加した",
};

export interface TraceLine {
  /** Wall-clock time of the first execution, as HH:MM:SS. */
  time: string;
  /** Sprite or stage name; empty when the target is gone. */
  target: string;
  /** Human-readable action. */
  label: string;
  /** "×12" for coalesced runs, empty for a single execution. */
  repeat: string;
}

export function formatTraceTime(
  timestamp: number,
  toDate: (value: number) => Date = value => new Date(value),
): string {
  const date = toDate(timestamp);
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(
    date.getSeconds(),
  )}`;
}

export function describeOpcode(opcode: string | null): string {
  if (!opcode) return "（削除されたブロック）";
  return OPCODE_LABELS_JA[opcode] ?? opcode;
}

export function formatTraceLine(
  entry: ResolvedTraceEntry,
  toDate?: (value: number) => Date,
): TraceLine {
  return {
    time: formatTraceTime(entry.firstTime, toDate),
    target: entry.targetName ?? "",
    label: describeOpcode(entry.opcode),
    repeat: entry.count > 1 ? `×${entry.count}` : "",
  };
}

/** Newest first — that is what someone debugging wants to read. */
export function formatTraceLines(
  entries: ResolvedTraceEntry[],
  toDate?: (value: number) => Date,
): TraceLine[] {
  return [...entries].reverse().map(entry => formatTraceLine(entry, toDate));
}

export interface TraceListView {
  render(entries: ResolvedTraceEntry[]): void;
}

/** Paint trace lines into `container` as a simple ordered list. */
export function createTraceListView(
  container: HTMLElement,
  documentRef: Document = container.ownerDocument,
): TraceListView {
  return {
    render(entries) {
      container.textContent = "";
      const lines = formatTraceLines(entries);
      if (lines.length === 0) {
        const empty = documentRef.createElement("p");
        empty.className = "trace-empty";
        empty.textContent = "まだ何も動いていません";
        container.appendChild(empty);
        return;
      }
      const list = documentRef.createElement("ol");
      list.className = "trace-list";
      for (const line of lines) {
        const item = documentRef.createElement("li");
        item.className = "trace-line";

        const time = documentRef.createElement("span");
        time.className = "trace-time";
        time.textContent = line.time;
        item.appendChild(time);

        if (line.target) {
          const target = documentRef.createElement("span");
          target.className = "trace-target";
          target.textContent = line.target;
          item.appendChild(target);
        }

        const label = documentRef.createElement("span");
        label.className = "trace-label";
        label.textContent = line.label;
        item.appendChild(label);

        if (line.repeat) {
          const repeat = documentRef.createElement("span");
          repeat.className = "trace-repeat";
          repeat.textContent = line.repeat;
          item.appendChild(repeat);
        }

        list.appendChild(item);
      }
      container.appendChild(list);
    },
  };
}
