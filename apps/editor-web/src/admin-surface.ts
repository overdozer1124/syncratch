/**
 * Minimal /admin classroom console (dev-quality UI).
 * Google Identity Services ID token → POST /api/admin/auth/google.
 */
import {
  ADMIN_AUTH_GOOGLE_PATH,
  ADMIN_AUTH_LOGOUT_PATH,
  ADMIN_AUTH_STATUS_PATH,
  ADMIN_ME_PATH,
  ADMIN_POLICIES_PATH,
  adminLinkReissuePath,
  adminLinkRevokePath,
  type ClassroomPolicy,
  type ClassroomRosterListItem,
  type StudentLinkListItem,
} from "@blocksync/classroom-access";
import {
  fetchAdminClassroomFlags,
  mountPolicySubmissionsPanel,
  type AdminClassroomFlags,
} from "./admin-submissions-ui.js";
import {
  fetchAdminRosterList,
  mountAdminRostersSection,
  mountPolicyRosterControls,
} from "./admin-rosters-ui.js";

declare global {
  interface Window {
    google?: {
      accounts: {
        id: {
          initialize: (config: Record<string, unknown>) => void;
          renderButton: (parent: HTMLElement, config: Record<string, unknown>) => void;
          prompt: () => void;
        };
      };
    };
  }
}

interface AdminMeResponse {
  ok: boolean;
  admin?: {adminId: string; email: string; displayName: string | null};
  csrfToken?: string;
  code?: string;
  message?: string;
}

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs: Record<string, string> = {},
  text?: string,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (key === "class") node.className = value;
    else node.setAttribute(key, value);
  }
  if (text !== undefined) node.textContent = text;
  return node;
}

async function api<T>(
  path: string,
  init: RequestInit & {csrfToken?: string} = {},
): Promise<T> {
  const headers = new Headers(init.headers);
  if (init.body && !headers.has("content-type")) {
    headers.set("content-type", "application/json");
  }
  if (init.csrfToken) headers.set("x-csrf-token", init.csrfToken);
  const response = await fetch(path, {
    ...init,
    headers,
    credentials: "same-origin",
  });
  return (await response.json()) as T;
}

function loadGisScript(): Promise<void> {
  if (window.google?.accounts?.id) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const existing = document.querySelector<HTMLScriptElement>(
      'script[data-syncratch-gis="1"]',
    );
    if (existing) {
      existing.addEventListener("load", () => resolve(), {once: true});
      existing.addEventListener("error", () => reject(new Error("GIS load failed")), {
        once: true,
      });
      return;
    }
    const script = document.createElement("script");
    script.src = "https://accounts.google.com/gsi/client";
    script.async = true;
    script.dataset.syncratchGis = "1";
    script.onload = () => resolve();
    script.onerror = () => reject(new Error("GIS load failed"));
    document.head.append(script);
  });
}

export async function startAdminSurface(root: HTMLElement): Promise<void> {
  root.hidden = false;
  root.replaceChildren();
  root.classList.add("admin-shell");

  const brand = el("p", {class: "admin-brand"}, "Syncratch");
  const kana = el("span", {class: "admin-brand-kana"}, " シンクラッチ");
  brand.append(kana);
  const heading = el("h1", {}, "管理者");
  const status = el("p", {class: "admin-status", "data-testid": "admin-status"});
  const body = el("div", {class: "admin-body", "data-testid": "admin-body"});
  root.append(brand, heading, status, body);

  const authStatus = await api<{
    ok: boolean;
    configured?: boolean;
    authenticated?: boolean;
  }>(ADMIN_AUTH_STATUS_PATH);

  if (!authStatus.configured) {
    status.textContent =
      "管理者ログインが未設定です。GOOGLE_CLIENT_ID と SYNCRATCH_ADMIN_EMAILS を設定してください。";
    return;
  }

  let csrfToken = "";
  let me = await api<AdminMeResponse>(ADMIN_ME_PATH);
  if (me.ok && me.csrfToken) {
    csrfToken = me.csrfToken;
    await renderConsole(body, status, () => csrfToken, token => {
      csrfToken = token;
    });
    return;
  }

  status.textContent =
    "登録済みの Google アカウントでログインしてください（許可リスト外は入れません）。";
  const buttonHost = el("div", {
    class: "admin-gis-button",
    "data-testid": "admin-gis-button",
  });
  body.append(buttonHost);

  const clientId =
    (import.meta.env.VITE_GOOGLE_CLIENT_ID as string | undefined)?.trim() || "";
  if (!clientId) {
    status.textContent =
      "VITE_GOOGLE_CLIENT_ID が無いためログインボタンを表示できません。";
    return;
  }

  try {
    await loadGisScript();
  } catch {
    status.textContent = "Google ログインの読み込みに失敗しました。";
    return;
  }

  window.google!.accounts.id.initialize({
    client_id: clientId,
    callback: async (response: {credential?: string}) => {
      const idToken = response.credential;
      if (!idToken) return;
      const result = await api<AdminMeResponse>(ADMIN_AUTH_GOOGLE_PATH, {
        method: "POST",
        body: JSON.stringify({idToken}),
      });
      if (!result.ok) {
        status.textContent =
          result.message || "このアカウントは管理者として登録されていません。";
        return;
      }
      csrfToken = result.csrfToken || "";
      status.textContent = `${result.admin?.email ?? ""} でログイン中`;
      body.replaceChildren();
      await renderConsole(body, status, () => csrfToken, token => {
        csrfToken = token;
      });
    },
  });
  window.google!.accounts.id.renderButton(buttonHost, {
    theme: "outline",
    size: "large",
    text: "signin_with",
    shape: "rectangular",
  });
}

async function renderConsole(
  body: HTMLElement,
  status: HTMLElement,
  getCsrf: () => string,
  setCsrf: (token: string) => void,
): Promise<void> {
  const me = await api<AdminMeResponse>(ADMIN_ME_PATH);
  if (!me.ok || !me.admin) {
    status.textContent = "ログインが必要です。";
    return;
  }
  if (me.csrfToken) setCsrf(me.csrfToken);
  status.textContent = `${me.admin.email} でログイン中（開発中の管理者画面）`;

  const logout = el("button", {type: "button", class: "admin-button"}, "ログアウト");
  logout.addEventListener("click", async () => {
    await api(ADMIN_AUTH_LOGOUT_PATH, {
      method: "POST",
      csrfToken: getCsrf(),
    });
    location.reload();
  });

  const createBtn = el(
    "button",
    {type: "button", class: "admin-button primary", "data-testid": "admin-create-policy"},
    "教室設定を作る",
  );
  const list = el("div", {class: "admin-policy-list", "data-testid": "admin-policy-list"});
  const rostersHost = el("div", {
    class: "admin-rosters-host",
    "data-testid": "admin-rosters-host",
  });
  body.append(logout, rostersHost, createBtn, list);

  const classroomFlags = await fetchAdminClassroomFlags();

  await mountAdminRostersSection(rostersHost, getCsrf, classroomFlags);

  async function refresh(): Promise<void> {
    const res = await api<{ok: boolean; policies: ClassroomPolicy[]}>(
      ADMIN_POLICIES_PATH,
    );
    list.replaceChildren();
    if (!res.ok) {
      list.textContent = "設定一覧を取得できませんでした。";
      return;
    }
    const rosters = classroomFlags?.classroomRosterEnabled
      ? await fetchAdminRosterList()
      : [];
    for (const policy of res.policies) {
      list.append(
        await renderPolicyCard(
          policy,
          getCsrf,
          refresh,
          classroomFlags,
          rosters,
        ),
      );
    }
    if (res.policies.length === 0) {
      list.textContent = "まだ教室設定がありません。";
    }
  }

  createBtn.addEventListener("click", async () => {
    const title = window.prompt("教室設定の名前", "新しい教室設定");
    if (!title) return;
    await api(ADMIN_POLICIES_PATH, {
      method: "POST",
      csrfToken: getCsrf(),
      body: JSON.stringify({
        title,
        aiAssist: {enabled: false, allowStudentApiKey: false},
        editor: {showSettingsPanel: false},
      }),
    });
    await refresh();
  });

  await refresh();
}

async function renderPolicyCard(
  policy: ClassroomPolicy,
  getCsrf: () => string,
  refresh: () => Promise<void>,
  classroomFlags: AdminClassroomFlags | null,
  rosters: ClassroomRosterListItem[],
): Promise<HTMLElement> {
  const card = el("section", {class: "admin-policy-card"});
  card.append(el("h2", {}, policy.title));
  card.append(
    el(
      "p",
      {class: "admin-muted"},
      `AI: ${policy.aiAssist.enabled ? "オン" : "オフ"} / 設定パネル: ${
        policy.editor.showSettingsPanel ? "表示" : "非表示"
      } / 拡張機能: ${policy.editor.allowExtensions ? "許可" : "禁止"} / 状態: ${
        policy.status
      }`,
    ),
  );

  const toggles = el("div", {class: "admin-toggles"});
  const aiToggle = el("label", {}, "");
  const aiCheck = el("input", {type: "checkbox"}) as HTMLInputElement;
  aiCheck.checked = policy.aiAssist.enabled;
  aiToggle.append(aiCheck, document.createTextNode(" AI を許可"));
  const settingsToggle = el("label", {}, "");
  const settingsCheck = el("input", {type: "checkbox"}) as HTMLInputElement;
  settingsCheck.checked = policy.editor.showSettingsPanel;
  settingsToggle.append(settingsCheck, document.createTextNode(" 生徒に設定パネルを出す"));
  const extensionsToggle = el("label", {}, "");
  const extensionsCheck = el("input", {type: "checkbox"}) as HTMLInputElement;
  extensionsCheck.checked = policy.editor.allowExtensions;
  extensionsToggle.append(
    extensionsCheck,
    document.createTextNode(" 拡張機能ギャラリーを許可"),
  );
  const save = el("button", {type: "button", class: "admin-button"}, "設定を保存");
  save.addEventListener("click", async () => {
    await api(`${ADMIN_POLICIES_PATH}/${encodeURIComponent(policy.policyId)}`, {
      method: "PATCH",
      csrfToken: getCsrf(),
      body: JSON.stringify({
        aiAssist: {enabled: aiCheck.checked, allowStudentApiKey: false},
        editor: {
          showSettingsPanel: settingsCheck.checked,
          allowExtensions: extensionsCheck.checked,
        },
      }),
    });
    await refresh();
  });
  toggles.append(aiToggle, settingsToggle, extensionsToggle, save);
  card.append(toggles);

  const linkBtn = el(
    "button",
    {type: "button", class: "admin-button primary", "data-testid": "admin-create-link"},
    "生徒用リンクを作る",
  );
  const expiryInput = el("input", {
    type: "datetime-local",
    class: "admin-expiry-input",
    "data-testid": "admin-link-expiry",
  }) as HTMLInputElement;
  const expiryLabel = el("label", {class: "admin-expiry-label"}, "");
  expiryLabel.append(document.createTextNode(" 有効期限（任意） "), expiryInput);
  const linkOut = el("p", {
    class: "admin-link-out",
    "data-testid": "admin-link-out",
  });
  linkBtn.addEventListener("click", async () => {
    const label = window.prompt("リンクのメモ", "授業用") || "授業用";
    const expiresAt = expiryInput.value
      ? new Date(expiryInput.value).toISOString()
      : null;
    const res = await api<{
      ok: boolean;
      link?: StudentLinkListItem & {studentUrl?: string; token?: string};
      message?: string;
      code?: string;
    }>(`${ADMIN_POLICIES_PATH}/${encodeURIComponent(policy.policyId)}/links`, {
      method: "POST",
      csrfToken: getCsrf(),
      body: JSON.stringify({label, expiresAt}),
    });
    if (!res.ok || !res.link?.studentUrl) {
      linkOut.textContent = res.message || "リンクを作れませんでした。";
      return;
    }
    linkOut.textContent = res.link.studentUrl;
    try {
      await navigator.clipboard.writeText(res.link.studentUrl);
      linkOut.textContent = `${res.link.studentUrl}（コピーしました）`;
    } catch {
      // ignore
    }
    await refreshLinks();
  });
  card.append(expiryLabel, linkBtn, linkOut);

  const linksBox = el("ul", {class: "admin-links"});
  card.append(linksBox);

  async function refreshLinks(): Promise<void> {
    const res = await api<{ok: boolean; links: StudentLinkListItem[]}>(
      `${ADMIN_POLICIES_PATH}/${encodeURIComponent(policy.policyId)}/links`,
    );
    linksBox.replaceChildren();
    if (!res.ok) return;
    for (const link of res.links) {
      const item = el("li", {});
      const expiryText = link.expiresAt
        ? ` / 期限: ${link.expiresAt}`
        : " / 期限: なし";
      item.textContent = `${link.label} — ${link.status} — ${link.createdAt}${expiryText}`;
      if (link.status === "active") {
        const revoke = el("button", {type: "button", class: "admin-button"}, "失効");
        revoke.addEventListener("click", async () => {
          await api(adminLinkRevokePath(link.linkId), {
            method: "POST",
            csrfToken: getCsrf(),
          });
          await refreshLinks();
        });
        const reissue = el("button", {type: "button", class: "admin-button"}, "再発行");
        reissue.addEventListener("click", async () => {
          const expiresAt = expiryInput.value
            ? new Date(expiryInput.value).toISOString()
            : null;
          const reissueRes = await api<{
            ok: boolean;
            link?: StudentLinkListItem & {studentUrl?: string};
            message?: string;
          }>(adminLinkReissuePath(link.linkId), {
            method: "POST",
            csrfToken: getCsrf(),
            body: JSON.stringify({expiresAt}),
          });
          if (reissueRes.ok && reissueRes.link?.studentUrl) {
            linkOut.textContent = `${reissueRes.link.studentUrl}（再発行・コピー推奨）`;
            try {
              await navigator.clipboard.writeText(reissueRes.link.studentUrl);
            } catch {
              // ignore
            }
          } else {
            linkOut.textContent = reissueRes.message || "再発行に失敗しました。";
          }
          await refreshLinks();
        });
        item.append(" ", revoke, " ", reissue);
      }
      linksBox.append(item);
    }
  }
  await refreshLinks();
  mountPolicyRosterControls(
    card,
    policy,
    rosters,
    classroomFlags,
    getCsrf,
    refresh,
  );
  await mountPolicySubmissionsPanel(card, policy, classroomFlags);
  return card;
}
