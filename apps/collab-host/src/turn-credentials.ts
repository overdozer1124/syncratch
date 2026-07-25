/**
 * Mint Open Relay static-auth TURN credentials for GET /ice.
 * Uses the same public secret documented by Metered for Nextcloud/Matrix.
 */
import {createHmac} from "node:crypto";

export const OPENRELAY_STATIC_AUTH_HOST = "staticauth.openrelay.metered.ca";
export const OPENRELAY_STATIC_AUTH_SECRET = "openrelayprojectsecret";
export const OPENRELAY_CREDENTIAL_TTL_SEC = 12 * 60 * 60;

export interface IceServerConfig {
  urls: string | string[];
  username?: string;
  credential?: string;
}

export interface IceCredentialsResponse {
  iceServers: IceServerConfig[];
}

export function mintOpenRelayIceServers(options: {
  nowMs?: number;
  ttlSec?: number;
  userId?: string;
} = {}): IceCredentialsResponse {
  const nowMs = options.nowMs ?? Date.now();
  const ttlSec = options.ttlSec ?? OPENRELAY_CREDENTIAL_TTL_SEC;
  const userId = (options.userId ?? "syncratch").replace(/:/g, "-");
  const expiry = Math.floor(nowMs / 1000) + ttlSec;
  const username = `${expiry}:${userId}`;
  const credential = createHmac("sha1", OPENRELAY_STATIC_AUTH_SECRET)
    .update(username)
    .digest("base64");
  const host = OPENRELAY_STATIC_AUTH_HOST;

  return {
    iceServers: [
      {urls: "stun:stun.l.google.com:19302"},
      {urls: "stun:stun1.l.google.com:19302"},
      {
        urls: [
          `turn:${host}:80`,
          `turn:${host}:443`,
          `turn:${host}:443?transport=tcp`,
          `turns:${host}:443`,
        ],
        username,
        credential,
      },
    ],
  };
}
