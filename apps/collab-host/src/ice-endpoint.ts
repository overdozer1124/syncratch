import type {IncomingMessage, ServerResponse} from "node:http";
import {mintOpenRelayIceServers} from "./turn-credentials.js";

/** GET /ice → ephemeral Open Relay ICE servers for the browser. */
export async function handleIceCredentials(
  req: IncomingMessage,
  res: ServerResponse,
): Promise<boolean> {
  const url = new URL(req.url ?? "/", "http://127.0.0.1");
  if (url.pathname !== "/ice") return false;
  if ((req.method ?? "GET") !== "GET" && (req.method ?? "GET") !== "HEAD") {
    res.writeHead(405, {"content-type": "text/plain; charset=utf-8"});
    res.end("method not allowed");
    return true;
  }

  const body = JSON.stringify(mintOpenRelayIceServers());
  res.writeHead(200, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
  });
  if ((req.method ?? "GET") === "HEAD") {
    res.end();
  } else {
    res.end(body);
  }
  return true;
}
