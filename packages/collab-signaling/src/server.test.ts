import {afterEach, describe, expect, it} from "vitest";
import {WebSocket} from "ws";
import {startSignalingServer, type SignalingServerHandle} from "./server.js";

const TOPIC = "b".repeat(43);
let handle: SignalingServerHandle | undefined;

afterEach(async () => {
  await handle?.close();
  handle = undefined;
});

function open(url: string): Promise<WebSocket> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url);
    ws.once("open", () => resolve(ws));
    ws.once("error", reject);
  });
}

function nextMessage(ws: WebSocket, predicate: (m: any) => boolean): Promise<any> {
  return new Promise((resolve) => {
    const handler = (raw: Buffer): void => {
      const msg = JSON.parse(raw.toString("utf8"));
      if (predicate(msg)) {
        ws.off("message", handler);
        resolve(msg);
      }
    };
    ws.on("message", handler);
  });
}

describe("startSignalingServer", () => {
  it("relays a signal between two real WebSocket peers over a topic", async () => {
    handle = await startSignalingServer();
    const a = await open(handle.url);
    const b = await open(handle.url);

    const aJoined = nextMessage(a, (m) => m.t === "joined");
    a.send(JSON.stringify({t: "join", topic: TOPIC, peer: "peer-a"}));
    await aJoined;

    const aSeesB = nextMessage(a, (m) => m.t === "peer" && m.peer === "peer-b");
    const bJoined = nextMessage(b, (m) => m.t === "joined");
    b.send(JSON.stringify({t: "join", topic: TOPIC, peer: "peer-b"}));
    await Promise.all([aSeesB, bJoined]);

    const bGetsSignal = nextMessage(b, (m) => m.t === "signal");
    a.send(
      JSON.stringify({t: "signal", topic: TOPIC, to: "peer-b", data: {kind: "offer"}}),
    );
    const signal = await bGetsSignal;
    expect(signal).toEqual({
      t: "signal",
      topic: TOPIC,
      from: "peer-a",
      data: {kind: "offer"},
    });

    a.close();
    b.close();
  });
});
