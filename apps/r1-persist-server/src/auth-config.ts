export type AuthMode = "stub" | "google";

export interface AuthBootConfig {
  mode: AuthMode;
  cookieSecure: boolean;
  allowedHostedDomains: string[];
  allowedOrigins: string[];
  googleClientId: string | undefined;
  googleAuthorizedParties: string[];
}

function splitCsv(raw: string | undefined): string[] {
  if (!raw) return [];
  return raw
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

function parseBool(raw: string | undefined, fallback: boolean): boolean {
  if (raw === undefined || raw === "") return fallback;
  const v = raw.trim().toLowerCase();
  if (v === "1" || v === "true" || v === "yes") return true;
  if (v === "0" || v === "false" || v === "no") return false;
  throw new Error(`Invalid boolean env value: ${raw}`);
}

export function assertAuthBootConfig(env: NodeJS.ProcessEnv): AuthBootConfig {
  const nodeEnv = env.NODE_ENV?.trim() || "development";
  const isProduction = nodeEnv === "production";
  const modeRaw = (env.R1_AUTH_MODE?.trim() || "stub").toLowerCase();
  if (modeRaw !== "stub" && modeRaw !== "google") {
    throw new Error(`Invalid R1_AUTH_MODE: ${modeRaw}`);
  }
  const mode = modeRaw as AuthMode;

  if (isProduction && mode === "stub") {
    throw new Error(
      "R1_AUTH_MODE=stub is forbidden when NODE_ENV=production",
    );
  }

  const cookieSecure = parseBool(
    env.R1_COOKIE_SECURE,
    mode === "google" ? true : false,
  );
  const allowInsecure =
    mode === "stub" ||
    (nodeEnv === "test" && env.R1_ALLOW_INSECURE_COOKIES === "1");

  if (mode === "google" && !cookieSecure && !allowInsecure) {
    throw new Error(
      "Cookie Secure must be true in google mode unless NODE_ENV=test and R1_ALLOW_INSECURE_COOKIES=1",
    );
  }

  if (isProduction && mode === "google" && !cookieSecure) {
    throw new Error("Cookie Secure must be true in production google mode");
  }

  const allowedHostedDomains = splitCsv(env.R1_ALLOWED_HOSTED_DOMAINS);
  const allowedOrigins = splitCsv(env.R1_ALLOWED_ORIGINS);
  const googleAuthorizedParties = splitCsv(env.R1_GOOGLE_AUTHORIZED_PARTIES);
  const googleClientId = env.R1_GOOGLE_CLIENT_ID?.trim() || undefined;

  if (mode === "google") {
    if (!googleClientId) {
      throw new Error("R1_GOOGLE_CLIENT_ID is required in google mode");
    }
    if (allowedOrigins.length === 0) {
      throw new Error(
        "R1_ALLOWED_ORIGINS must be a non-empty allow-list in google mode",
      );
    }
  }

  return {
    mode,
    cookieSecure,
    allowedHostedDomains,
    allowedOrigins,
    googleClientId,
    googleAuthorizedParties,
  };
}
