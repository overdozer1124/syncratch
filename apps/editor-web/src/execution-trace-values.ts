import type {TraceValue} from "./execution-trace-types.js";

export const TRACE_STRING_LIMIT = 120;

export function truncateTraceString(value: string, limit = TRACE_STRING_LIMIT): string {
  if (value.length <= limit) return value;
  return `${value.slice(0, limit - 1)}…`;
}

export function serializeTraceValue(value: unknown, limit = TRACE_STRING_LIMIT): TraceValue {
  if (value === null || value === undefined) return null;
  if (typeof value === "boolean" || typeof value === "number") {
    if (typeof value === "number" && !Number.isFinite(value)) return null;
    return value;
  }
  if (typeof value === "string") return truncateTraceString(value, limit);
  if (typeof value === "object") {
    const record = value as Record<string, unknown>;
    if (typeof record.name === "string") {
      return {
        id: typeof record.id === "string" ? record.id : undefined,
        name: truncateTraceString(record.name, limit),
      };
    }
  }
  return truncateTraceString(String(value), limit);
}

export function serializeTraceArgs(
  args: Record<string, unknown>,
): Record<string, TraceValue> {
  const out: Record<string, TraceValue> = {};
  for (const [key, value] of Object.entries(args)) {
    if (key === "mutation") continue;
    out[key] = serializeTraceValue(value);
  }
  return out;
}

export function traceValueToText(value: TraceValue | undefined): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "boolean") return value ? "はい" : "いいえ";
  if (typeof value === "number") return formatTraceNumber(value);
  if (typeof value === "string") return value;
  return value.name;
}

export function formatTraceNumber(value: number): string {
  if (Number.isInteger(value)) return String(value);
  const rounded = Math.round(value * 100) / 100;
  return String(rounded);
}

export function formatDirection(value: number): string {
  let normalized = value % 360;
  if (normalized > 180) normalized -= 360;
  if (normalized <= -180) normalized += 360;
  return formatTraceNumber(normalized);
}

export function argsSignature(args: Record<string, TraceValue>): string {
  return JSON.stringify(args);
}
