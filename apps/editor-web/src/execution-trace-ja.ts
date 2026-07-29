/**
 * Learner-facing Japanese labels for execution-history text.
 * Prefer past-tense phrases that match Scratch block meaning (ja).
 */

import type {TraceSemanticSnapshot, TraceValue} from "./execution-trace-types.js";
import {formatTraceNumber, traceValueToText} from "./execution-trace-values.js";

/** Internal menu / field values → Japanese (Scratch ja UI). */
export const TRACE_MENU_VALUE_JA: Record<string, string> = {
  // motion_setrotationstyle
  "left-right": "左右のみ",
  "don't rotate": "回転しない",
  "all around": "自由に回転",
  // control_stop
  all: "すべて",
  "this script": "このスクリプト",
  "other scripts in sprite": "スプライトの他のスクリプト",
  // motion_goto / glideto / pointtowards menus
  _random_: "どこかの場所",
  _mouse_: "マウスのポインター",
  // looks front/back layers
  front: "最前面",
  back: "最背面",
  forward: "手前",
  backward: "奥",
  // looks / sound effects
  COLOR: "色",
  FISHEYE: "魚眼レンズ",
  WHIRL: "渦巻き",
  PIXELATE: "ピクセル化",
  MOSAIC: "モザイク",
  BRIGHTNESS: "明るさ",
  GHOST: "幽霊",
  PITCH: "ピッチ",
  PAN: "左右バランス",
  // costume/backdrop number-name
  number: "番号",
  name: "名前",
  // sensing_current
  YEAR: "年",
  MONTH: "月",
  DATE: "日",
  DAYOFWEEK: "曜日",
  HOUR: "時",
  MINUTE: "分",
  SECOND: "秒",
  // sensing_setdragmode
  draggable: "ドラッグできる",
  "not draggable": "ドラッグできない",
  // keys (common)
  space: "スペース",
  "left arrow": "左向き矢印",
  "right arrow": "右向き矢印",
  "up arrow": "上向き矢印",
  "down arrow": "下向き矢印",
  any: "どれかの",
};

/** Short Japanese names when a full past-tense phrase is not available. */
export const TRACE_OPCODE_NAME_JA: Record<string, string> = {
  motion_movesteps: "歩かせる",
  motion_turnright: "右に回す",
  motion_turnleft: "左に回す",
  motion_goto: "場所へ行く",
  motion_gotoxy: "座標へ行く",
  motion_glidesecstoxy: "秒かけて座標へ行く",
  motion_glideto: "秒かけて場所へ行く",
  motion_pointindirection: "向きを変える",
  motion_pointtowards: "何かの方を向く",
  motion_changexby: "x座標を変える",
  motion_changeyby: "y座標を変える",
  motion_setx: "x座標を決める",
  motion_sety: "y座標を決める",
  motion_ifonedgebounce: "端で跳ね返る",
  motion_setrotationstyle: "回転方法を決める",
  looks_say: "言う",
  looks_sayforsecs: "秒言う",
  looks_think: "考える",
  looks_thinkforsecs: "秒考える",
  looks_show: "表示する",
  looks_hide: "隠す",
  looks_switchcostumeto: "コスチュームを変える",
  looks_nextcostume: "次のコスチュームにする",
  looks_switchbackdropto: "背景を変える",
  looks_switchbackdroptoandwait: "背景を変えて待つ",
  looks_nextbackdrop: "次の背景にする",
  looks_changesizeby: "大きさを変える",
  looks_setsizeto: "大きさを決める",
  looks_changeeffectby: "効果を変える",
  looks_seteffectto: "効果を決める",
  looks_cleargraphiceffects: "画像効果をなくす",
  looks_gotofrontback: "前面/背面へ移動する",
  looks_goforwardbackwardlayers: "レイヤーを動かす",
  sound_play: "音を鳴らす",
  sound_playuntildone: "鳴り終わるまで音を鳴らす",
  sound_stopallsounds: "すべての音を止める",
  sound_changeeffectby: "音の効果を変える",
  sound_seteffectto: "音の効果を決める",
  sound_cleareffects: "音の効果をなくす",
  sound_changevolumeby: "音量を変える",
  sound_setvolumeto: "音量を決める",
  event_whenflagclicked: "緑の旗",
  event_whenkeypressed: "キーが押されたとき",
  event_whenthisspriteclicked: "このスプライトが押されたとき",
  event_whenstageclicked: "ステージが押されたとき",
  event_whenbackdropswitchesto: "背景が変わったとき",
  event_whengreaterthan: "大きくなったとき",
  event_whenbroadcastreceived: "メッセージを受け取ったとき",
  event_broadcast: "メッセージを送る",
  event_broadcastandwait: "メッセージを送って待つ",
  control_wait: "待つ",
  control_repeat: "繰り返す",
  control_forever: "ずっと",
  control_if: "もしなら",
  control_if_else: "もしでなければ",
  control_wait_until: "まで待つ",
  control_repeat_until: "まで繰り返す",
  control_stop: "止める",
  control_start_as_clone: "クローンされたとき",
  control_create_clone_of: "クローンを作る",
  control_delete_this_clone: "このクローンを削除する",
  sensing_askandwait: "聞いて待つ",
  sensing_resettimer: "タイマーをリセット",
  sensing_setdragmode: "ドラッグできるかを決める",
  data_setvariableto: "変数を決める",
  data_changevariableby: "変数を変える",
  data_showvariable: "変数を表示する",
  data_hidevariable: "変数を隠す",
  data_addtolist: "リストに追加する",
  data_deleteoflist: "リストから削除する",
  data_deletealloflist: "リストを全部消す",
  data_insertatlist: "リストに挿入する",
  data_replaceitemoflist: "リストを置き換える",
  data_showlist: "リストを表示する",
  data_hidelist: "リストを隠す",
  pen_clear: "全部消す",
  pen_stamp: "スタンプする",
  pen_penDown: "ペンを下ろす",
  pen_penUp: "ペンを上げる",
  pen_setPenColorToColor: "ペンの色を決める",
  pen_changePenColorParamBy: "ペンの色パラメータを変える",
  pen_setPenColorParamTo: "ペンの色パラメータを決める",
  pen_changePenSizeBy: "ペンの太さを変える",
  pen_setPenSizeTo: "ペンの太さを決める",
  music_playDrumForBeats: "ドラムを鳴らす",
  music_restForBeats: "休符",
  music_playNoteForBeats: "音符を鳴らす",
  music_setInstrument: "楽器を決める",
  music_setTempo: "テンポを決める",
  music_changeTempo: "テンポを変える",
};

type JaArgs = Record<string, TraceValue>;

function num(args: JaArgs, key: string): number | null {
  const value = args[key];
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function text(args: JaArgs, key: string): string {
  return localizeTraceArgValue(key, args[key]);
}

function fmtNum(value: number | null, fallback = "…"): string {
  return value === null ? fallback : formatTraceNumber(value);
}

/**
 * Localize a captured arg for learner-facing text.
 * Menu ids become Japanese; numbers/booleans stay readable.
 */
export function localizeTraceArgValue(
  key: string,
  value: TraceValue | undefined,
): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "boolean") return value ? "はい" : "いいえ";
  if (typeof value === "number") return formatTraceNumber(value);
  if (typeof value === "object") return value.name;
  const mapped = TRACE_MENU_VALUE_JA[value];
  if (mapped) return mapped;
  // Some menus arrive case-insensitively or with surrounding spaces.
  const trimmed = value.trim();
  return TRACE_MENU_VALUE_JA[trimmed] ?? trimmed;
}

function fillNamedTemplate(template: string, args: JaArgs): string {
  return template.replace(/\{([A-Z0-9_]+)\}/g, (_match, key: string) => {
    const localized = text(args, key);
    return localized || "…";
  });
}

type JaDescribe = (snapshot: TraceSemanticSnapshot) => string | null;

/** Past-tense Japanese phrases for opcodes that lack dedicated descriptors. */
const JA_DESCRIBE: Record<string, JaDescribe> = {
  motion_setrotationstyle: s => {
    const style = text(s.args, "STYLE");
    return style ? `回転方法を${style}にした` : "回転方法を決めた";
  },
  motion_gotoxy: s =>
    `x座標 ${fmtNum(num(s.args, "X"))}、y座標 ${fmtNum(num(s.args, "Y"))} へ行った`,
  motion_goto: s => {
    const to = text(s.args, "TO");
    return to ? `${to}へ行った` : "場所へ行った";
  },
  motion_glidesecstoxy: s =>
    `${fmtNum(num(s.args, "SECS"))}秒かけて x ${fmtNum(num(s.args, "X"))}、y ${fmtNum(num(s.args, "Y"))} へ滑って行った`,
  motion_glideto: s => {
    const to = text(s.args, "TO");
    const secs = fmtNum(num(s.args, "SECS"));
    return to ? `${secs}秒かけて${to}へ滑って行った` : `${secs}秒かけて滑って行った`;
  },
  motion_pointindirection: s => {
    const direction = num(s.args, "DIRECTION");
    return direction === null
      ? "向きを変えた"
      : `向きを ${fmtNum(direction)}° にした`;
  },
  motion_pointtowards: s => {
    const towards = text(s.args, "TOWARDS");
    return towards ? `${towards}の方を向いた` : "何かの方を向いた";
  },
  motion_changexby: s => {
    const dx = num(s.args, "DX");
    return dx === null ? "x座標を変えた" : `x座標を ${fmtNum(dx)} ずつ変えた`;
  },
  motion_changeyby: s => {
    const dy = num(s.args, "DY");
    return dy === null ? "y座標を変えた" : `y座標を ${fmtNum(dy)} ずつ変えた`;
  },
  looks_think: s => {
    const message = text(s.args, "MESSAGE");
    return message ? `「${message}」と考えた` : "考えた";
  },
  looks_thinkforsecs: s => {
    const message = text(s.args, "MESSAGE");
    const secs = num(s.args, "SECS");
    if (!message && secs === null) return "少しの間考えた";
    if (secs === null) return `「${message}」と考えた`;
    return `「${message}」と ${fmtNum(secs)} 秒考えた`;
  },
  looks_show: () => "表示した",
  looks_hide: () => "隠した",
  looks_switchcostumeto: s => {
    const costume = text(s.args, "COSTUME");
    return costume ? `コスチュームを「${costume}」にした` : "コスチュームを変えた";
  },
  looks_nextcostume: () => "次のコスチュームにした",
  looks_switchbackdropto: s => {
    const backdrop = text(s.args, "BACKDROP");
    return backdrop ? `背景を「${backdrop}」にした` : "背景を変えた";
  },
  looks_switchbackdroptoandwait: s => {
    const backdrop = text(s.args, "BACKDROP");
    return backdrop
      ? `背景を「${backdrop}」にして待った`
      : "背景を変えて待った";
  },
  looks_nextbackdrop: () => "次の背景にした",
  looks_changesizeby: s => {
    const change = num(s.args, "CHANGE");
    return change === null
      ? "大きさを変えた"
      : `大きさを ${fmtNum(change)} ずつ変えた`;
  },
  looks_setsizeto: s => {
    const size = num(s.args, "SIZE");
    return size === null ? "大きさを決めた" : `大きさを ${fmtNum(size)} にした`;
  },
  looks_changeeffectby: s => {
    const effect = text(s.args, "EFFECT");
    const change = num(s.args, "CHANGE");
    if (!effect && change === null) return "画像効果を変えた";
    if (change === null) return `${effect}の効果を変えた`;
    return `${effect || "効果"}を ${fmtNum(change)} ずつ変えた`;
  },
  looks_seteffectto: s => {
    const effect = text(s.args, "EFFECT");
    const value = num(s.args, "VALUE");
    if (!effect && value === null) return "画像効果を決めた";
    if (value === null) return `${effect}の効果を決めた`;
    return `${effect || "効果"}を ${fmtNum(value)} にした`;
  },
  looks_cleargraphiceffects: () => "画像効果をなくした",
  looks_gotofrontback: s => {
    const frontBack = text(s.args, "FRONT_BACK");
    return frontBack ? `${frontBack}へ移動した` : "前面/背面へ移動した";
  },
  looks_goforwardbackwardlayers: s => {
    const direction = text(s.args, "FORWARD_BACKWARD");
    const layers = num(s.args, "NUM");
    if (!direction && layers === null) return "レイヤーを動かした";
    if (layers === null) return `${direction}へレイヤーを動かした`;
    return `${direction || "レイヤー"}へ ${fmtNum(layers)} 層動かした`;
  },
  sound_play: s => {
    const sound = text(s.args, "SOUND_MENU");
    return sound ? `「${sound}」の音を鳴らした` : "音を鳴らした";
  },
  sound_playuntildone: s => {
    const sound = text(s.args, "SOUND_MENU");
    return sound
      ? `「${sound}」が鳴り終わるまで鳴らした`
      : "鳴り終わるまで音を鳴らした";
  },
  sound_stopallsounds: () => "すべての音を止めた",
  sound_changeeffectby: s => {
    const effect = text(s.args, "EFFECT");
    const value = num(s.args, "VALUE");
    if (!effect && value === null) return "音の効果を変えた";
    if (value === null) return `${effect}の音の効果を変えた`;
    return `${effect || "音の効果"}を ${fmtNum(value)} ずつ変えた`;
  },
  sound_seteffectto: s => {
    const effect = text(s.args, "EFFECT");
    const value = num(s.args, "VALUE");
    if (!effect && value === null) return "音の効果を決めた";
    if (value === null) return `${effect}の音の効果を決めた`;
    return `${effect || "音の効果"}を ${fmtNum(value)} にした`;
  },
  sound_cleareffects: () => "音の効果をなくした",
  sound_changevolumeby: s => {
    const volume = num(s.args, "VOLUME");
    return volume === null
      ? "音量を変えた"
      : `音量を ${fmtNum(volume)} ずつ変えた`;
  },
  sound_setvolumeto: s => {
    const volume = num(s.args, "VOLUME");
    return volume === null ? "音量を決めた" : `音量を ${fmtNum(volume)} にした`;
  },
  event_whenkeypressed: s => {
    const key = text(s.args, "KEY_OPTION");
    return key ? `「${key}」キーが押された` : "キーが押された";
  },
  event_whenthisspriteclicked: () => "このスプライトが押された",
  event_whenstageclicked: () => "ステージが押された",
  event_whenbackdropswitchesto: s => {
    const backdrop = text(s.args, "BACKDROP");
    return backdrop
      ? `背景が「${backdrop}」になった`
      : "背景が変わった";
  },
  event_whengreaterthan: s => {
    const what = text(s.args, "WHENGREATERTHANMENU");
    const value = num(s.args, "VALUE");
    if (!what && value === null) return "値が大きくなった";
    if (value === null) return `${what}が大きくなった`;
    return `${what || "値"}が ${fmtNum(value)} より大きくなった`;
  },
  event_whenbroadcastreceived: s => {
    const message = text(s.args, "BROADCAST_OPTION");
    return message
      ? `「${message}」を受け取った`
      : "メッセージを受け取った";
  },
  control_wait_until: () => "条件になるまで待った",
  control_repeat_until: () => "条件になるまで繰り返した",
  control_create_clone_of: s => {
    const clone = text(s.args, "CLONE_OPTION");
    return clone ? `「${clone}」のクローンを作った` : "クローンを作った";
  },
  control_delete_this_clone: () => "このクローンを削除した",
  control_start_as_clone: () => "クローンとして動き始めた",
  sensing_askandwait: s => {
    const question = text(s.args, "QUESTION");
    return question ? `「${question}」と聞いて待った` : "聞いて待った";
  },
  sensing_resettimer: () => "タイマーをリセットした",
  sensing_setdragmode: s => {
    const mode = text(s.args, "DRAG_MODE");
    return mode ? `${mode}にした` : "ドラッグできるかを決めた";
  },
  data_showvariable: s => {
    const name = text(s.args, "VARIABLE") || "変数";
    return `変数「${name}」を表示した`;
  },
  data_hidevariable: s => {
    const name = text(s.args, "VARIABLE") || "変数";
    return `変数「${name}」を隠した`;
  },
  data_addtolist: s => {
    const item = text(s.args, "ITEM");
    const list = text(s.args, "LIST") || "リスト";
    return item
      ? `リスト「${list}」に「${item}」を追加した`
      : `リスト「${list}」に追加した`;
  },
  data_deleteoflist: s => {
    const index = text(s.args, "INDEX");
    const list = text(s.args, "LIST") || "リスト";
    return index
      ? `リスト「${list}」の ${index} 番目を消した`
      : `リスト「${list}」から消した`;
  },
  data_deletealloflist: s => {
    const list = text(s.args, "LIST") || "リスト";
    return `リスト「${list}」を全部消した`;
  },
  data_insertatlist: s => {
    const item = text(s.args, "ITEM");
    const index = text(s.args, "INDEX");
    const list = text(s.args, "LIST") || "リスト";
    return `リスト「${list}」の ${index || "…"} 番目に「${item || "…"}」を入れた`;
  },
  data_replaceitemoflist: s => {
    const item = text(s.args, "ITEM");
    const index = text(s.args, "INDEX");
    const list = text(s.args, "LIST") || "リスト";
    return `リスト「${list}」の ${index || "…"} 番目を「${item || "…"}」に変えた`;
  },
  data_showlist: s => {
    const list = text(s.args, "LIST") || "リスト";
    return `リスト「${list}」を表示した`;
  },
  data_hidelist: s => {
    const list = text(s.args, "LIST") || "リスト";
    return `リスト「${list}」を隠した`;
  },
  pen_clear: () => "全部消した",
  pen_stamp: () => "スタンプした",
  pen_penDown: () => "ペンを下ろした",
  pen_penUp: () => "ペンを上げた",
  pen_setPenColorToColor: () => "ペンの色を決めた",
  pen_changePenColorParamBy: () => "ペンの色を変えた",
  pen_setPenColorParamTo: () => "ペンの色を決めた",
  pen_changePenSizeBy: s => {
    const size = num(s.args, "SIZE");
    return size === null
      ? "ペンの太さを変えた"
      : `ペンの太さを ${fmtNum(size)} ずつ変えた`;
  },
  pen_setPenSizeTo: s => {
    const size = num(s.args, "SIZE");
    return size === null
      ? "ペンの太さを決めた"
      : `ペンの太さを ${fmtNum(size)} にした`;
  },
  music_playDrumForBeats: s => {
    const beats = num(s.args, "BEATS");
    return beats === null
      ? "ドラムを鳴らした"
      : `ドラムを ${fmtNum(beats)} 拍鳴らした`;
  },
  music_restForBeats: s => {
    const beats = num(s.args, "BEATS");
    return beats === null ? "休符を入れた" : `${fmtNum(beats)} 拍休んだ`;
  },
  music_playNoteForBeats: s => {
    const note = text(s.args, "NOTE");
    const beats = num(s.args, "BEATS");
    if (!note && beats === null) return "音符を鳴らした";
    if (beats === null) return `音符「${note}」を鳴らした`;
    return `音符「${note || "…"}」を ${fmtNum(beats)} 拍鳴らした`;
  },
  music_setInstrument: () => "楽器を決めた",
  music_setTempo: s => {
    const tempo = num(s.args, "TEMPO");
    return tempo === null ? "テンポを決めた" : `テンポを ${fmtNum(tempo)} にした`;
  },
  music_changeTempo: s => {
    const tempo = num(s.args, "TEMPO");
    return tempo === null
      ? "テンポを変えた"
      : `テンポを ${fmtNum(tempo)} ずつ変えた`;
  },
};

export function describeOpcodeInJapanese(
  snapshot: TraceSemanticSnapshot,
): string | null {
  const opcode = snapshot.opcode;
  if (!opcode) return null;
  const describe = JA_DESCRIBE[opcode];
  if (describe) {
    const textValue = describe(snapshot);
    if (textValue) return textValue;
  }
  return null;
}

export function japaneseOpcodeName(opcode: string | null | undefined): string | null {
  if (!opcode) return null;
  return TRACE_OPCODE_NAME_JA[opcode] ?? null;
}

/** Localize values inside a Blockly/Scratch message0 template fill. */
export function localizeArgsForDisplay(
  args: Record<string, TraceValue>,
): Record<string, TraceValue> {
  const out: Record<string, TraceValue> = {};
  for (const [key, value] of Object.entries(args)) {
    if (typeof value === "string") {
      out[key] = localizeTraceArgValue(key, value);
    } else {
      out[key] = value;
    }
  }
  return out;
}

export function fillNamedJaTemplate(
  template: string,
  args: Record<string, TraceValue>,
): string {
  return fillNamedTemplate(template, args);
}

export function fallbackJapaneseLabel(
  opcode: string | null | undefined,
  displayTemplate: string | null | undefined,
): string {
  const name = japaneseOpcodeName(opcode);
  if (name) return name;
  if (displayTemplate && !/^[a-z0-9_]+$/i.test(displayTemplate.trim())) {
    // Drop printf placeholders for a short noun phrase.
    return displayTemplate.replace(/%[nsb]/gi, "…").replace(/\s+/g, " ").trim();
  }
  return "ブロック";
}

export {traceValueToText};
