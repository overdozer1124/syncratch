/**
 * @experimental Gate 0 Google ID token verification (authentication only).
 */

import * as jose from "jose";

export const GOOGLE_ISSUERS = [
  "https://accounts.google.com",
  "accounts.google.com",
] as const;

export const ALLOWED_ALGS = ["RS256"] as const;

export interface GoogleIdentityClaims {
  sub: string;
  email?: string;
  email_verified?: boolean;
  hd?: string;
  azp?: string;
  aud: string | string[];
  iss: string;
  exp: number;
  iat: number;
}

export type VerifyFailureCode =
  | "INVALID_TOKEN"
  | "BAD_SIGNATURE"
  | "UNKNOWN_KID"
  | "JWKS_FETCH_FAILED"
  | "BAD_ISS"
  | "BAD_AUD"
  | "BAD_AZP"
  | "EXPIRED"
  | "BAD_IAT"
  | "MISSING_EXP"
  | "BAD_ALG"
  | "MISSING_SUB"
  | "EMAIL_NOT_VERIFIED"
  | "HD_MISSING"
  | "HD_MISMATCH"
  | "HOOKS_FORBIDDEN";

export type VerifyResult =
  | { ok: true; claims: GoogleIdentityClaims }
  | { ok: false; code: VerifyFailureCode; message: string };

export type JwksProvider = (
  header: jose.JWTHeaderParameters,
) => Promise<CryptoKey | Uint8Array>;

export interface VerifyGoogleIdTokenOptions {
  audience: string | string[];
  authorizedParties?: string[];
  allowedHostedDomains?: string[];
  requireEmailVerified?: boolean;
  /**
   * Test-only. Ignored unless test hooks are enabled.
   * Production always uses real wall clock and default clockTolerance (60s).
   */
  clockToleranceSec?: number;
  /** Test-only. Ignored unless test hooks are enabled. */
  now?: () => number;
  /** Test-only JWKS resolver. */
  jwksProvider?: JwksProvider;
  /** Test-only JWKS URL override. */
  jwksUrl?: string;
  allowTestHooks?: boolean;
}

const DEFAULT_JWKS_URL = "https://www.googleapis.com/oauth2/v3/certs";
const DEFAULT_CLOCK_TOLERANCE_SEC = 60;
const MAX_IAT_FUTURE_SKEW_SEC = 60;

function testHooksEnabled(allowTestHooks?: boolean): boolean {
  if (!allowTestHooks) return false;
  return (
    process.env.NODE_ENV === "test" || process.env.GATE0_TEST_HOOKS === "1"
  );
}

function asStringAud(aud: unknown): string[] {
  if (typeof aud === "string") return [aud];
  if (Array.isArray(aud)) return aud.map(String);
  return [];
}

function wallNowSec(): number {
  return Math.floor(Date.now() / 1000);
}

export async function verifyGoogleIdToken(
  token: string,
  options: VerifyGoogleIdTokenOptions,
): Promise<VerifyResult> {
  const hooksOk = testHooksEnabled(options.allowTestHooks);

  if ((options.jwksProvider || options.jwksUrl || options.now || options.clockToleranceSec !== undefined) && !hooksOk) {
    if (options.jwksProvider || (options.jwksUrl && options.jwksUrl !== DEFAULT_JWKS_URL) || options.now || options.clockToleranceSec !== undefined) {
      return {
        ok: false,
        code: "HOOKS_FORBIDDEN",
        message:
          "now/clockTolerance/custom JWKS only allowed when allowTestHooks=true and NODE_ENV=test or GATE0_TEST_HOOKS=1",
      };
    }
  }

  let getKey: JwksProvider;
  if (options.jwksProvider && hooksOk) {
    getKey = options.jwksProvider;
  } else {
    const url =
      hooksOk && options.jwksUrl ? options.jwksUrl : DEFAULT_JWKS_URL;
    const remote = jose.createRemoteJWKSet(new URL(url));
    getKey = async (header) => remote(header);
  }

  const nowSec = hooksOk && options.now ? options.now() : wallNowSec();
  const clockTolerance =
    hooksOk && options.clockToleranceSec !== undefined
      ? options.clockToleranceSec
      : DEFAULT_CLOCK_TOLERANCE_SEC;

  let payload: jose.JWTPayload;
  let protectedHeader: jose.JWTHeaderParameters;
  try {
    const verified = await jose.jwtVerify(token, getKey, {
      issuer: [...GOOGLE_ISSUERS],
      audience: options.audience,
      algorithms: [...ALLOWED_ALGS],
      clockTolerance,
      currentDate: new Date(nowSec * 1000),
    });
    payload = verified.payload;
    protectedHeader = verified.protectedHeader;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (/alg|algorithm/i.test(msg)) {
      return { ok: false, code: "BAD_ALG", message: msg };
    }
    if (/JWKS|fetch|network|ENOENT|ECONN/i.test(msg)) {
      return { ok: false, code: "JWKS_FETCH_FAILED", message: msg };
    }
    if (/kid|"no applicable key"|unknown/i.test(msg)) {
      return { ok: false, code: "UNKNOWN_KID", message: msg };
    }
    if (/signature|JWS/i.test(msg)) {
      return { ok: false, code: "BAD_SIGNATURE", message: msg };
    }
    if (/unexpected "aud"|audience|"aud"/i.test(msg)) {
      return { ok: false, code: "BAD_AUD", message: msg };
    }
    if (/unexpected "iss"|issuer/i.test(msg)) {
      return { ok: false, code: "BAD_ISS", message: msg };
    }
    if (/exp|timestamp|current too/i.test(msg)) {
      return { ok: false, code: "EXPIRED", message: msg };
    }
    return { ok: false, code: "INVALID_TOKEN", message: msg };
  }

  if (protectedHeader.alg !== "RS256") {
    return {
      ok: false,
      code: "BAD_ALG",
      message: `alg ${String(protectedHeader.alg)} is not RS256`,
    };
  }

  if (payload.exp === undefined || typeof payload.exp !== "number") {
    return { ok: false, code: "MISSING_EXP", message: "exp is required" };
  }
  if (payload.exp < nowSec - clockTolerance) {
    return { ok: false, code: "EXPIRED", message: "token expired" };
  }

  if (payload.iat === undefined || typeof payload.iat !== "number") {
    return { ok: false, code: "BAD_IAT", message: "iat is required" };
  }
  if (payload.iat > nowSec + MAX_IAT_FUTURE_SKEW_SEC) {
    return {
      ok: false,
      code: "BAD_IAT",
      message: "iat is unacceptably in the future",
    };
  }

  if (!payload.sub || typeof payload.sub !== "string") {
    return { ok: false, code: "MISSING_SUB", message: "sub is required" };
  }

  const requireEmail = options.requireEmailVerified !== false;
  if (requireEmail && payload.email_verified !== true) {
    return {
      ok: false,
      code: "EMAIL_NOT_VERIFIED",
      message: "email_verified must be true",
    };
  }

  const azp = typeof payload.azp === "string" ? payload.azp : undefined;
  if (options.authorizedParties && options.authorizedParties.length > 0) {
    if (!azp || !options.authorizedParties.includes(azp)) {
      return {
        ok: false,
        code: "BAD_AZP",
        message: `azp ${azp ?? "(missing)"} not in authorizedParties`,
      };
    }
  }

  if (options.allowedHostedDomains && options.allowedHostedDomains.length > 0) {
    const hd = typeof payload.hd === "string" ? payload.hd : undefined;
    if (!hd) {
      return {
        ok: false,
        code: "HD_MISSING",
        message: "hd claim required in school-restricted mode",
      };
    }
    if (!options.allowedHostedDomains.includes(hd)) {
      return {
        ok: false,
        code: "HD_MISMATCH",
        message: `hd ${hd} is not an exact match for allowed domains`,
      };
    }
  }

  const claims: GoogleIdentityClaims = {
    sub: payload.sub,
    email: typeof payload.email === "string" ? payload.email : undefined,
    email_verified:
      typeof payload.email_verified === "boolean"
        ? payload.email_verified
        : undefined,
    hd: typeof payload.hd === "string" ? payload.hd : undefined,
    azp,
    aud:
      asStringAud(payload.aud).length === 1
        ? asStringAud(payload.aud)[0]!
        : asStringAud(payload.aud),
    iss: String(payload.iss),
    exp: payload.exp,
    iat: payload.iat,
  };

  return { ok: true, claims };
}
