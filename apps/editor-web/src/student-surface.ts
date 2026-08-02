import {
  STUDENT_GRANT_PATH,
  STUDENT_POLICY_PATH,
  STUDENT_SURFACE_SESSION_PATH,
  type StudentPolicyView,
} from "@blocksync/classroom-access";

function normalizeBasePath(basePath: string): string {
  if (!basePath || basePath === "/") return "";
  return basePath.endsWith("/") ? basePath.slice(0, -1) : basePath;
}

/** @deprecated Phase 2: use grant exchange + fetchStudentPolicyFromGrant. */
export async function fetchStudentPolicy(
  token: string,
): Promise<StudentPolicyView | null> {
  try {
    const response = await fetch(`/api/student/policy-by-token/${encodeURIComponent(token)}`, {
      credentials: "same-origin",
      headers: {accept: "application/json"},
    });
    if (!response.ok) return null;
    const body = (await response.json()) as {
      ok?: boolean;
      policy?: StudentPolicyView;
    };
    if (!body.ok || !body.policy) return null;
    return body.policy;
  } catch {
    return null;
  }
}

export async function exchangeStudentGrant(token: string): Promise<boolean> {
  try {
    const response = await fetch(STUDENT_GRANT_PATH, {
      method: "POST",
      credentials: "same-origin",
      headers: {
        accept: "application/json",
        "content-type": "application/json",
      },
      body: JSON.stringify({token}),
    });
    return response.ok;
  } catch {
    return false;
  }
}

export async function fetchStudentPolicyFromGrant(): Promise<StudentPolicyView | null> {
  try {
    const response = await fetch(STUDENT_POLICY_PATH, {
      credentials: "same-origin",
      headers: {accept: "application/json"},
    });
    if (!response.ok) return null;
    const body = (await response.json()) as {
      ok?: boolean;
      policy?: StudentPolicyView;
    };
    if (!body.ok || !body.policy) return null;
    return body.policy;
  } catch {
    return null;
  }
}

/** Replace `/s/{token}` with token-less `/s` after grant exchange. */
export function replaceStudentUrlWithoutToken(
  basePath = typeof import.meta !== "undefined"
    ? String(import.meta.env?.BASE_URL ?? "/")
    : "/",
): void {
  const base = normalizeBasePath(basePath);
  const nextPath = `${base}${STUDENT_SURFACE_SESSION_PATH}`;
  history.replaceState(null, "", nextPath);
}

export function showStudentLinkError(root: HTMLElement): void {
  root.hidden = false;
  root.replaceChildren();
  root.classList.add("student-error-shell");
  const brand = document.createElement("p");
  brand.className = "admin-brand";
  brand.textContent = "Syncratch";
  const title = document.createElement("h1");
  title.textContent = "このリンクは使えません";
  const help = document.createElement("p");
  help.textContent =
    "リンクが間違っているか、期限切れ・失効している可能性があります。管理者に連絡してください。";
  root.append(brand, title, help);
}
