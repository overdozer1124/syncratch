/**
 * Lightweight Google userinfo fetch for toolbar avatar display.
 * Requires the userinfo.profile scope on the access token.
 */

export interface GoogleUserProfile {
  sub?: string;
  name?: string;
  picture?: string;
}

const USERINFO_URL = "https://www.googleapis.com/oauth2/v3/userinfo";

export async function fetchGoogleUserProfile(
  accessToken: string,
  fetchImpl: typeof fetch = fetch,
): Promise<GoogleUserProfile | null> {
  if (!accessToken) return null;
  try {
    const response = await fetchImpl(USERINFO_URL, {
      method: "GET",
      headers: {
        authorization: `Bearer ${accessToken}`,
        accept: "application/json",
      },
    });
    if (!response.ok) return null;
    const body = (await response.json()) as Record<string, unknown>;
    const picture =
      typeof body.picture === "string" && body.picture.trim()
        ? body.picture.trim()
        : undefined;
    const name =
      typeof body.name === "string" && body.name.trim()
        ? body.name.trim()
        : undefined;
    const sub =
      typeof body.sub === "string" && body.sub.trim()
        ? body.sub.trim()
        : undefined;
    if (!picture && !name && !sub) return null;
    return {picture, name, sub};
  } catch {
    return null;
  }
}
