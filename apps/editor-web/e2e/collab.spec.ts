import {expect, test, type Page} from "@playwright/test";

// The signaling server treats the topic as an opaque hashed value; both peers
// only need to present the same valid topic string. A fixed base64url-safe
// value keeps the E2E independent of the (separately unit-tested) hash.
const SIGNALING_URL = "ws://127.0.0.1:4455";
const TOPIC = "e2ecollabtopic0123456789";
const SECRET = "e2e-high-entropy-room-secret-value-1234";

function harnessUrl(participantId: string, host: boolean): string {
  const params = new URLSearchParams({
    signalingUrl: SIGNALING_URL,
    topic: TOPIC,
    secret: SECRET,
    participantId,
    host: host ? "1" : "0",
  });
  return `/collab-harness.html?${params.toString()}`;
}

async function openPeer(page: Page, participantId: string, host: boolean): Promise<void> {
  await page.goto(harnessUrl(participantId, host));
  await page.waitForFunction(() => window.__collab?.ready === true);
  expect(await page.evaluate(() => window.__collab?.error)).toBeNull();
}

test("two real browser contexts edit different sprites and converge over WebRTC", async ({
  browser,
}) => {
  const contextA = await browser.newContext();
  const contextB = await browser.newContext();
  const pageA = await contextA.newPage();
  const pageB = await contextB.newPage();

  try {
    await openPeer(pageA, "peer-a", true);
    await openPeer(pageB, "peer-b", false);

    // Signaling reachability first (ws connected to the configured URL).
    await pageA.waitForFunction(() => window.__collab!.status() === "connected", undefined, {timeout: 15_000});
    await pageB.waitForFunction(() => window.__collab!.status() === "connected", undefined, {timeout: 15_000});

    // Wait for a real peer-to-peer data channel to open on both sides.
    await pageA.waitForFunction(() => window.__collab!.peers().length === 1, undefined, {
      timeout: 60_000,
    });
    await pageB.waitForFunction(() => window.__collab!.peers().length === 1, undefined, {
      timeout: 60_000,
    });

    // Guest received the full shared project from the host.
    await pageB.waitForFunction(() => window.__collab!.targetName("s2") === "S2", undefined, {
      timeout: 60_000,
    });

    // Concurrent edits to DIFFERENT sprites.
    expect(await pageA.evaluate(() => window.__collab!.editTarget("s1", "EditedByA"))).toBe(true);
    expect(await pageB.evaluate(() => window.__collab!.editTarget("s2", "EditedByB"))).toBe(true);

    // Both peers converge to the merged state.
    await pageB.waitForFunction(
      () => window.__collab!.targetName("s1") === "EditedByA",
      undefined,
      {timeout: 60_000},
    );
    await pageA.waitForFunction(
      () => window.__collab!.targetName("s2") === "EditedByB",
      undefined,
      {timeout: 60_000},
    );

    expect(await pageA.evaluate(() => window.__collab!.targetName("s1"))).toBe("EditedByA");
    expect(await pageB.evaluate(() => window.__collab!.targetName("s2"))).toBe("EditedByB");
    expect(await pageA.evaluate(() => window.__collab!.materializeOk())).toBe(true);
    expect(await pageB.evaluate(() => window.__collab!.materializeOk())).toBe(true);
  } finally {
    await contextA.close();
    await contextB.close();
  }
});

test("two real browsers add different stacks on the same sprite and both survive", async ({
  browser,
}) => {
  const contextA = await browser.newContext();
  const contextB = await browser.newContext();
  const pageA = await contextA.newPage();
  const pageB = await contextB.newPage();
  const topic = "e2esameSpriteBlocks0123456789ab";
  const harness = (participantId: string, host: boolean): string => {
    const params = new URLSearchParams({
      signalingUrl: SIGNALING_URL,
      topic,
      secret: SECRET,
      participantId,
      host: host ? "1" : "0",
    });
    return `/collab-harness.html?${params.toString()}`;
  };

  try {
    await pageA.goto(harness("peer-a-blocks", true));
    await pageA.waitForFunction(() => window.__collab?.ready === true);
    await pageB.goto(harness("peer-b-blocks", false));
    await pageB.waitForFunction(() => window.__collab?.ready === true);

    await pageA.waitForFunction(() => window.__collab!.peers().length === 1, undefined, {
      timeout: 60_000,
    });
    await pageB.waitForFunction(() => window.__collab!.peers().length === 1, undefined, {
      timeout: 60_000,
    });
    await pageB.waitForFunction(() => window.__collab!.targetName("s1") === "S1", undefined, {
      timeout: 60_000,
    });

    expect(
      await pageA.evaluate(() =>
        window.__collab!.upsertBlock("s1", {
          id: "stackA",
          opcode: "event_whenflagclicked",
          next: null,
          parent: null,
          inputs: {},
          fields: {},
          shadow: false,
          topLevel: true,
          x: 20,
          y: 20,
        }),
      ),
    ).toBe(true);
    expect(
      await pageB.evaluate(() =>
        window.__collab!.upsertBlock("s1", {
          id: "stackB",
          opcode: "event_whenkeypressed",
          next: null,
          parent: null,
          inputs: {},
          fields: {},
          shadow: false,
          topLevel: true,
          x: 220,
          y: 20,
        }),
      ),
    ).toBe(true);

    await pageA.waitForFunction(
      () => {
        const ops = window.__collab!.blockOpcodes("s1");
        return ops.includes("event_whenflagclicked") && ops.includes("event_whenkeypressed");
      },
      undefined,
      {timeout: 60_000},
    );
    await pageB.waitForFunction(
      () => {
        const ops = window.__collab!.blockOpcodes("s1");
        return ops.includes("event_whenflagclicked") && ops.includes("event_whenkeypressed");
      },
      undefined,
      {timeout: 60_000},
    );
  } finally {
    await contextA.close();
    await contextB.close();
  }
});

declare global {
  interface Window {
    __collab?: {
      ready: boolean;
      error: string | null;
      status(): string;
      peers(): string[];
      editTarget(id: string, name: string): boolean;
      upsertBlock(
        targetId: string,
        block: {
          id: string;
          opcode: string;
          next: string | null;
          parent: string | null;
          inputs: Record<string, unknown>;
          fields: Record<string, unknown>;
          shadow: boolean;
          topLevel: boolean;
          x?: number;
          y?: number;
        },
      ): boolean;
      blockOpcodes(targetId: string): string[];
      targetName(id: string): string | null;
      materializeOk(): boolean;
    };
  }
}
