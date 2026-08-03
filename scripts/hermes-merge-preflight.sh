#!/usr/bin/env bash
# Hermes merge preflight — exit 0 only when Hermes GO exists AFTER the latest Cursor submission.
# Usage: scripts/hermes-merge-preflight.sh <case-id> [pr-number]
#
# PR #201 lesson: never merge on agent-written GO, stale GO, or CI green alone.

set -euo pipefail

CASE_ID="${1:-}"
PR_NUMBER="${2:-}"
HANDOFF="${HANDOFF:-docs/CURSOR_CODEX_HANDOFF.md}"

if [[ -z "$CASE_ID" ]]; then
  echo "usage: $0 <case-id> [pr-number]" >&2
  exit 2
fi

if [[ ! -f "$HANDOFF" ]]; then
  echo "FAIL: handoff not found: $HANDOFF" >&2
  exit 1
fi

if ! grep -q "$CASE_ID" "$HANDOFF"; then
  echo "FAIL: case id not found in handoff: $CASE_ID" >&2
  exit 1
fi

# Line after which we require a fresh Hermes verdict (latest Cursor READY_FOR_HERMES_REVIEW)
AFTER_LINE=0
while IFS= read -r line_num; do
  start=$line_num
  chunk=$(sed -n "${start},$((start + 25))p" "$HANDOFF")
  if echo "$chunk" | grep -q "$CASE_ID" && echo "$chunk" | grep -q 'READY_FOR_HERMES_REVIEW'; then
    AFTER_LINE=$start
  fi
done < <(grep -n '^### .* Cursor' "$HANDOFF" | cut -d: -f1)

if [[ "$AFTER_LINE" -eq 0 ]]; then
  echo "FAIL: no Cursor READY_FOR_HERMES_REVIEW entry for $CASE_ID" >&2
  exit 1
fi

LAST_VERDICT=""
LAST_HEADER=""
LAST_START_LINE=0

while IFS= read -r start_line; do
  if [[ "$start_line" -le "$AFTER_LINE" ]]; then
    continue
  fi
  header=$(sed -n "${start_line}p" "$HANDOFF")
  chunk=$(sed -n "${start_line},$((start_line + 45))p" "$HANDOFF")
  if ! echo "$chunk" | grep -q "$CASE_ID"; then
    continue
  fi
  verdict=$(echo "$chunk" | grep -E '^判定:' | head -1 | sed 's/^判定:[[:space:]]*//')
  if [[ -n "$verdict" ]]; then
    LAST_VERDICT="$verdict"
    LAST_HEADER="$header"
    LAST_START_LINE=$start_line
  fi
done < <(grep -n '^### .* Hermes' "$HANDOFF" | cut -d: -f1)

if [[ -z "$LAST_VERDICT" ]]; then
  echo "FAIL: no Hermes 判定 after latest Cursor READY_FOR_HERMES_REVIEW (line $AFTER_LINE)" >&2
  echo "  Wait for Hermes GO on the current submission before merge." >&2
  exit 1
fi

if echo "$LAST_VERDICT" | grep -qE 'NO-GO|差し戻し'; then
  echo "FAIL: Hermes verdict after latest submission is NO-GO" >&2
  echo "  Entry: $LAST_HEADER" >&2
  echo "  Verdict: $LAST_VERDICT" >&2
  exit 1
fi

if ! echo "$LAST_VERDICT" | grep -qE '^GO|^APPROVED_PENDING_CI'; then
  echo "FAIL: Hermes verdict is not unconditional GO" >&2
  echo "  Entry: $LAST_HEADER" >&2
  echo "  Verdict: $LAST_VERDICT" >&2
  exit 1
fi

if [[ -n "$PR_NUMBER" && "$LAST_START_LINE" -gt 0 ]]; then
  chunk_after=$(sed -n "${LAST_START_LINE},$((LAST_START_LINE + 45))p" "$HANDOFF")
  if ! echo "$chunk_after" | grep -qE "PR: #${PR_NUMBER}|PR #${PR_NUMBER}"; then
    echo "WARN: GO entry may not reference PR #${PR_NUMBER} — verify manually" >&2
  fi
fi

echo "OK: Hermes GO found after latest Cursor submission for $CASE_ID"
echo "  Entry: $LAST_HEADER"
echo "  Verdict: $LAST_VERDICT"
echo "  Next: confirm Blocker/Major IDs match PR diff, then merge."
exit 0
