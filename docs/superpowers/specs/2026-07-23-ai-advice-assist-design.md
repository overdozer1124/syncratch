# Syncratch AI Advice Assist (prototype)

**Status:** Prototype track (parallel to Local-First collab)

**Date:** 2026-07-23

**Non-interference:** Does not modify Yjs, WebRTC, signaling, Drive autosave, or local project envelope paths. Settings are browser `localStorage` only.

## Goals

1. Advice-first AI coaching (説明 / ヒント / デバッグ助言). Auto-apply to VM is out of scope for this slice.
2. Master switch **default OFF**; user can toggle anytime from the toolbar **設定** panel.
3. API key entered in **設定**; provider auto-detected from key prefix; cheap default model selected.
4. Spec §29 levels 0–6 modeled; prototype UX emphasizes levels 1–2.
5. Spec §35 sanitization: strip email / attendance / phone / token-like strings before send.
6. Spec §31 `BlockIRProposal` types exist as a contract; mutation apply is deferred.

## Components

| Piece | Location | Role |
|---|---|---|
| Core library | `packages/ai-assist` | detect, levels, settings, sanitize, context, prompt, client, forwarder, IR types |
| Same-origin proxy | `apps/collab-host` `POST /ai/chat` | CORS-safe forward; Authorization Bearer from client; never stores keys |
| Editor UI | `apps/editor-web` settings + AI panels | toggle, key, level, ask |
| Vite dev proxy | `ai-chat-dev-proxy` via `ssrLoadModule` | config must not statically import `@blocksync/ai-assist` (Node ESM) |

## Data boundaries

- API key / settings: `localStorage` key `blocksync.ai-assist.settings.v1` only.
- Never write AI secrets into ProjectDocument, Y.Doc, `.sb3`, Drive snapshots, or signaling messages.
- Project context sent to AI is opcode summary only (no costumes, sounds, assets, peer roster).

## Provider detection (prefix order)

`sk-ant-` → Anthropic · `sk-or-` → OpenRouter · `gsk_` → Groq · `AIza` → Gemini · `xai-` → xAI · `sk-proj-` / `sk-` → OpenAI

Cheap defaults: `claude-3-5-haiku-latest`, `gpt-4o-mini`, `gemini-2.0-flash-lite`, `llama-3.1-8b-instant`, etc.

## Follow-ups (not in this slice)

- IR validation → Mutation API → preview / selective apply / AI Undo
- Teacher / workspace policy inheritance
- Autonomous debug loops (spec §34: deferred)
- Server-side usage budgets and audit (School track)
