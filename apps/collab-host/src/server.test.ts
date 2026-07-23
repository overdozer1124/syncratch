import {mkdtempSync, writeFileSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {afterEach, describe, expect, it} from "vitest";
import {WebSocket} from "ws";
import {startCollabHost, type CollabHostHandle} from "./server.js";

const TOPIC = "c".repeat(43);
let handle: CollabHostHandle | undefined;

afterEach(async () => {
  await handle?.close();
  handle = undefined;
});

describe("startCollabHost", () => {
  it("serves static files and relays signaling on /signal", async () => {
    const root = mkdtempSync(join(tmpdir(), "collab-host-"));
    writeFileSync(join(root, "index.html"), "<html>host</html>");

    handle = await startCollabHost({
      host: "127.0.0.1",
      port: 0,
      staticRoot: root,
    });

    const page = await fetch(handle.url);
    expect(page.status).toBe(200);
    expect(await page.text()).toContain("host");

    const health = await fetch(new URL("/healthz", handle.url));
    expect(health.status).toBe(200);

    const a = await open(handle.signalingUrl);
    const b = await open(handle.signalingUrl);
    const aJoined = nextMessage(a, (m) => m.t === "joined");
    a.send(JSON.stringify({t: "join", topic: TOPIC, peer: "peer-a"}));
    await aJoined;
    const aSeesB = nextMessage(a, (m) => m.t === "peer" && m.peer === "peer-b");
    const bJoined = nextMessage(b, (m) => m.t === "joined");
    b.send(JSON.stringify({t: "join", topic: TOPIC, peer: "peer-b"}));
    await Promise.all([aSeesB, bJoined]);
    a.close();
    b.close();
  });

  it("proxies /ai/chat without touching signaling", async () => {
    const root = mkdtempSync(join(tmpdir(), "collab-host-ai-"));
    writeFileSync(join(root, "index.html"), "<html>host</html>");

    handle = await startCollabHost({
      host: "127.0.0.1",
      port: 0,
      staticRoot: root,
    });

    const unauthorized = await fetch(new URL("/ai/chat", handle.url), {
      method: "POST",
      headers: {"content-type": "application/json"},
      body: JSON.stringify({
        provider: "openai",
        model: "gpt-4o-mini",
        messages: [{role: "user", content: "hi"}],
      }),
    });
    expect(unauthorized.status).toBe(401);

    const previousFetch = globalThis.fetch;
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.includes("api.openai.com")) {
        return new Response(
          JSON.stringify({
            choices: [{message: {content: "proxy-ok"}}],
          }),
          {status: 200, headers: {"content-type": "application/json"}},
        );
      }
      return previousFetch(input, init);
    }) as typeof fetch;

    try {
      const ok = await fetch(new URL("/ai/chat", handle.url), {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: "Bearer sk-test-key",
        },
        body: JSON.stringify({
          provider: "openai",
          model: "gpt-4o-mini",
          messages: [{role: "user", content: "hi"}],
        }),
      });
      expect(ok.status).toBe(200);
      const body = (await ok.json()) as {ok: boolean; content?: string};
      expect(body.ok).toBe(true);
      expect(body.content).toBe("proxy-ok");
    } finally {
      globalThis.fetch = previousFetch;
    }
  });
});

function open(url: string): Promise<WebSocket> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url);
    ws.once("open", () => resolve(ws));
    ws.once("error", reject);
  });
}

function nextMessage(
  ws: WebSocket,
  predicate: (m: Record<string, unknown>) => boolean,
): Promise<Record<string, unknown>> {
  return new Promise((resolve) => {
    const handler = (raw: Buffer): void => {
      const msg = JSON.parse(raw.toString("utf8")) as Record<string, unknown>;
      if (predicate(msg)) {
        ws.off("message", handler);
        resolve(msg);
      }
    };
    ws.on("message", handler);
  });
}
