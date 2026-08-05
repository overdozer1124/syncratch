/**
 * Syncratch /admin console — 2a master/detail layout.
 */
import {
  ADMIN_AUTH_GOOGLE_PATH,
  ADMIN_AUTH_LOGOUT_PATH,
  ADMIN_AUTH_STATUS_PATH,
  ADMIN_ME_PATH,
  ADMIN_POLICIES_PATH,
  ADMIN_ROSTERS_PATH,
  adminLinkRevokePath,
  adminLinksForPolicyPath,
  adminPolicyPath,
  studentSurfacePath,
  type ClassroomPolicy,
  type ClassroomRosterListItem,
  type StudentLinkListItem,
} from "@blocksync/classroom-access";
import {
  adminFetch,
  createAdminSaveFooter,
  createBadge,
  createSegmentControl,
  debounce,
  el,
  emptyValue,
  type AdminSaveFooterController,
} from "./admin-console-shared.js";
import {fetchAdminClassroomFlags, type AdminClassroomFlags} from "./admin-submissions-ui.js";
import {
  fetchAdminRosterList,
  mountAdminRostersSection,
  mountPolicyRosterControls,
  renderAccountPane,
  renderRosterPane,
  type AdminPaneContext,
} from "./admin-rosters-ui.js";
import {mountPolicySubmissionsPanel} from "./admin-submissions-ui.js";

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

type AdminSelection =
  | {kind: "policy"; policyId: string}
  | {kind: "roster"; rosterId: string}
  | {kind: "account"};

const linkUrlCache = new Map<string, string>();

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

function buildQrImageUrl(studentUrl: string): string {
  return `https://api.qrserver.com/v1/create-qr-code/?size=300x300&data=${encodeURIComponent(studentUrl)}`;
}

function policyStatusBadge(status: string): HTMLElement {
  if (status === "active") return createBadge("active", "success");
  return createBadge("停止", "neutral");
}

function policyRailSubline(
  policy: ClassroomPolicy,
  rosters: ClassroomRosterListItem[],
): string {
  if (!policy.rosterId) return "名簿なし · 匿名リンク";
  const roster = rosters.find(r => r.rosterId === policy.rosterId);
  if (!roster) return "名簿なし · 匿名リンク";
  return `${roster.title} · ${roster.studentCount}名`;
}

function rosterRailSubline(roster: ClassroomRosterListItem): string {
  if (roster.syncStatus === "sync_required") {
    return `同期エラー · ${roster.studentCount}名`;
  }
  return `Sheet 同期 · ${roster.studentCount}名`;
}

export async function startAdminSurface(root: HTMLElement): Promise<void> {
  document.documentElement.classList.add("admin-console-mode");
  document.body.classList.add("admin-console-mode");
  root.hidden = false;
  root.replaceChildren();
  root.classList.add("admin-shell", "admin2-shell");

  const authStatus = await adminFetch<{
    ok: boolean;
    configured?: boolean;
    authenticated?: boolean;
  }>(ADMIN_AUTH_STATUS_PATH);

  if (!authStatus.configured) {
    root.classList.add("admin2-login");
    root.append(
      el("h1", {}, "管理者"),
      el(
        "p",
        {class: "admin-status", "data-testid": "admin-status"},
        "管理者ログインが未設定です。GOOGLE_CLIENT_ID と SYNCRATCH_ADMIN_EMAILS を設定してください。",
      ),
    );
    return;
  }

  let csrfToken = "";
  const me = await adminFetch<AdminMeResponse>(ADMIN_ME_PATH);
  if (me.ok && me.csrfToken) {
    csrfToken = me.csrfToken;
    await renderConsole(root, me, () => csrfToken, token => {
      csrfToken = token;
    });
    return;
  }

  root.classList.add("admin2-login");
  const status = el("p", {
    class: "admin-status",
    "data-testid": "admin-status",
  }, "登録済みの Google アカウントでログインしてください（許可リスト外は入れません）。");
  const body = el("div", {"data-testid": "admin-body"});
  const buttonHost = el("div", {
    class: "admin-gis-button",
    "data-testid": "admin-gis-button",
  });
  body.append(buttonHost);
  root.append(el("h1", {}, "管理者"), status, body);

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
      const result = await adminFetch<AdminMeResponse>(ADMIN_AUTH_GOOGLE_PATH, {
        method: "POST",
        body: JSON.stringify({idToken}),
      });
      if (!result.ok) {
        status.textContent =
          result.message || "このアカウントは管理者として登録されていません。";
        return;
      }
      csrfToken = result.csrfToken || "";
      root.classList.remove("admin2-login");
      root.replaceChildren();
      await renderConsole(root, result, () => csrfToken, token => {
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
  root: HTMLElement,
  me: AdminMeResponse,
  getCsrf: () => string,
  setCsrf: (token: string) => void,
): Promise<void> {
  const freshMe = await adminFetch<AdminMeResponse>(ADMIN_ME_PATH);
  if (!freshMe.ok || !freshMe.admin) {
    root.append(
      el(
        "p",
        {class: "admin-status", "data-testid": "admin-status"},
        "ログインが必要です。",
      ),
    );
    return;
  }
  if (freshMe.csrfToken) setCsrf(freshMe.csrfToken);

  const adminEmail = freshMe.admin.email;
  const saveFooter = createAdminSaveFooter();
  let policies: ClassroomPolicy[] = [];
  let rosters: ClassroomRosterListItem[] = [];
  let classroomFlags: AdminClassroomFlags | null = null;
  let selection: AdminSelection | null = null;
  let searchQuery = "";

  const hiddenPolicyList = el("div", {
    class: "admin-policy-list",
    "data-testid": "admin-policy-list",
  });
  const hiddenLinkOut = el("p", {
    class: "admin-link-out",
    "data-testid": "admin-link-out",
  });
  const rostersHost = el("div", {
    class: "admin-rosters-host",
    "data-testid": "admin-rosters-host",
  });

  const frame = el("div", {class: "admin2-frame"});
  const topbar = el("div", {class: "admin2-topbar"});
  topbar.append(
    el("div", {class: "admin2-topbar-brand"}, undefined),
    el("div", {class: "admin2-topbar-actions"}, undefined),
  );
  topbar.querySelector(".admin2-topbar-brand")!.append(
    el("span", {class: "admin2-topbar-title"}, "Syncratch"),
    el("span", {class: "admin2-topbar-kana"}, "シンクラッチ"),
    el("span", {class: "admin2-topbar-sep"}),
    el("span", {class: "admin2-topbar-role"}, "管理者"),
  );
  const topbarActions = topbar.querySelector(".admin2-topbar-actions")!;
  topbarActions.append(
    el("span", {class: "admin2-topbar-email"}, adminEmail),
  );
  const topbarLogout = el(
    "button",
    {type: "button", class: "admin2-btn-topbar"},
    "ログアウト",
  );
  topbarLogout.addEventListener("click", () => {
    void adminFetch(ADMIN_AUTH_LOGOUT_PATH, {
      method: "POST",
      csrfToken: getCsrf(),
    }).then(() => location.reload());
  });
  topbarActions.append(topbarLogout);

  const layout = el("div", {class: "admin2-layout"});
  const rail = el("aside", {class: "admin2-rail"});
  const searchWrap = el("div", {class: "admin2-rail-search-wrap"});
  const searchInput = el("input", {
    type: "text",
    class: "admin2-rail-search",
    placeholder: "教室・名簿を検索",
  }) as HTMLInputElement;
  searchWrap.append(searchInput);
  const railScroll = el("div", {class: "admin2-rail-scroll"});
  rail.append(searchWrap, railScroll);

  const paneHost = el("div", {class: "admin2-pane-host"});
  layout.append(rail, paneHost);

  const body = el("div", {class: "admin-body", "data-testid": "admin-body"});
  body.append(frame);
  frame.append(topbar, layout);

  const status = el("p", {
    class: "admin-status admin2-hidden-host",
    "data-testid": "admin-status",
  }, `${adminEmail} でログイン中`);

  root.append(status, body, hiddenPolicyList, hiddenLinkOut, rostersHost);

  searchInput.addEventListener("input", () => {
    searchQuery = searchInput.value.trim().toLowerCase();
    renderRail();
  });

  document.addEventListener("admin2-logout", () => {
    void adminFetch(ADMIN_AUTH_LOGOUT_PATH, {
      method: "POST",
      csrfToken: getCsrf(),
    }).then(() => location.reload());
  });

  document.addEventListener("admin2-select-roster", (event: Event) => {
    const rosterId = (event as CustomEvent<{rosterId: string}>).detail?.rosterId;
    if (rosterId) select({kind: "roster", rosterId});
  });

  function paneContext(): AdminPaneContext {
    return {
      getCsrf,
      flags: classroomFlags,
      saveFooter,
      onRefresh: refreshAll,
      rosters,
      adminEmail,
    };
  }

  async function refreshAll(): Promise<void> {
    classroomFlags = await fetchAdminClassroomFlags();
    const policyRes = await adminFetch<{ok: boolean; policies: ClassroomPolicy[]}>(
      ADMIN_POLICIES_PATH,
    );
    policies = policyRes.ok ? policyRes.policies : [];
    rosters = classroomFlags?.classroomRosterEnabled
      ? await fetchAdminRosterList()
      : [];
    hiddenPolicyList.replaceChildren();
    for (const policy of policies) {
      hiddenPolicyList.append(el("div", {"data-policy-id": policy.policyId}, policy.title));
    }
    await mountAdminRostersSection(rostersHost, getCsrf, classroomFlags);
    renderRail();
    if (selection) {
      await renderPane();
    } else if (policies.length > 0) {
      select({kind: "policy", policyId: policies[0]!.policyId});
    } else {
      select({kind: "account"});
    }
  }

  function matchesSearch(text: string): boolean {
    if (!searchQuery) return true;
    return text.toLowerCase().includes(searchQuery);
  }

  function renderRail(): void {
    railScroll.replaceChildren();

    const policyGroupHead = el("div", {class: "admin2-rail-group-head"});
    policyGroupHead.append(
      el("span", {class: "admin2-rail-group-title"}, "教室設定"),
      el("span", {class: "admin2-rail-group-count"}, String(policies.length)),
    );
    const createPolicyBtn = el(
      "button",
      {
        type: "button",
        class: "admin2-rail-add",
        "data-testid": "admin-create-policy",
      },
      "＋",
    );
    createPolicyBtn.addEventListener("click", () => {
      void createPolicy();
    });
    policyGroupHead.append(createPolicyBtn);
    railScroll.append(policyGroupHead);

    for (const policy of policies) {
      if (!matchesSearch(`${policy.title} ${policy.policyId}`)) continue;
      const item = el("button", {
        type: "button",
        class:
          selection?.kind === "policy" && selection.policyId === policy.policyId
            ? "admin2-rail-item is-selected"
            : "admin2-rail-item",
      });
      const text = el("div", {class: "admin2-rail-item-text"});
      text.append(
        el("span", {class: "admin2-rail-item-title"}, policy.title),
        el(
          "span",
          {
            class:
              policy.status === "disabled"
                ? "admin2-rail-item-sub is-empty"
                : "admin2-rail-item-sub",
          },
          policyRailSubline(policy, rosters),
        ),
      );
      item.append(
        text,
        policy.status === "disabled"
          ? createBadge("停止", "neutral")
          : createBadge("active", "success"),
      );
      item.addEventListener("click", () => select({kind: "policy", policyId: policy.policyId}));
      railScroll.append(item);
    }

    const accountHead = el("div", {
      class: "admin2-rail-group-head is-separated",
    });
    accountHead.append(el("span", {class: "admin2-rail-group-title"}, "アカウント"));
    railScroll.append(accountHead);

    const accountItem = el("button", {
      type: "button",
      class:
        selection?.kind === "account"
          ? "admin2-rail-item is-selected"
          : "admin2-rail-item",
    });
    const accountText = el("div", {class: "admin2-rail-item-text"});
    accountText.append(
      el("span", {class: "admin2-rail-item-title"}, "Google 連携"),
      el("span", {class: "admin2-rail-item-sub"}, adminEmail),
    );
    accountItem.append(accountText, createBadge("連携中", "success"));
    accountItem.addEventListener("click", () => select({kind: "account"}));
    railScroll.append(accountItem);

    if (classroomFlags?.classroomRosterEnabled) {
      const rosterHead = el("div", {
        class: "admin2-rail-group-head is-separated",
      });
      rosterHead.append(
        el("span", {class: "admin2-rail-group-title"}, "名簿"),
        el("span", {class: "admin2-rail-group-count"}, String(rosters.length)),
      );
      const createRosterBtn = el(
        "button",
        {
          type: "button",
          class: "admin2-rail-add",
          "data-testid": "admin-create-roster",
        },
        "＋",
      );
      createRosterBtn.addEventListener("click", () => {
        void createRoster();
      });
      rosterHead.append(createRosterBtn);
      railScroll.append(rosterHead);

      for (const roster of rosters) {
        if (!matchesSearch(roster.title)) continue;
        const item = el("button", {
          type: "button",
          class:
            selection?.kind === "roster" && selection.rosterId === roster.rosterId
              ? "admin2-rail-item is-selected"
              : "admin2-rail-item",
        });
        const text = el("div", {class: "admin2-rail-item-text"});
        text.append(
          el("span", {class: "admin2-rail-item-title"}, roster.title),
          el(
            "span",
            {
              class:
                roster.syncStatus === "sync_required"
                  ? "admin2-rail-item-sub is-warn"
                  : "admin2-rail-item-sub",
            },
            rosterRailSubline(roster),
          ),
        );
        const badge =
          roster.syncStatus === "sync_required"
            ? createBadge("要確認", "warn")
            : undefined;
        item.append(text);
        if (badge) item.append(badge);
        item.addEventListener("click", () => select({kind: "roster", rosterId: roster.rosterId}));
        railScroll.append(item);
      }
    }
  }

  async function createPolicy(): Promise<void> {
    const title = window.prompt("教室設定の名前", "新しい教室設定");
    if (!title) return;
    await adminFetch(ADMIN_POLICIES_PATH, {
      method: "POST",
      csrfToken: getCsrf(),
      body: JSON.stringify({
        title,
        aiAssist: {enabled: false, allowStudentApiKey: false},
        editor: {showSettingsPanel: false},
      }),
    });
    await refreshAll();
  }

  async function createRoster(): Promise<void> {
    const title = window.prompt("名簿の名前", "2026年度 3年A組");
    if (!title) return;
    await adminFetch(ADMIN_ROSTERS_PATH, {
      method: "POST",
      csrfToken: getCsrf(),
      body: JSON.stringify({title}),
    });
    await refreshAll();
  }

  function select(next: AdminSelection): void {
    selection = next;
    renderRail();
    void renderPane();
  }

  async function renderPane(): Promise<void> {
    paneHost.replaceChildren();
    if (!selection) return;

    if (selection.kind === "account") {
      paneHost.append(renderAccountPane(paneContext()));
      return;
    }

    if (selection.kind === "roster") {
      const pane = await renderRosterPane(paneContext(), selection.rosterId);
      if (pane) paneHost.append(pane);
      return;
    }

    const policy = policies.find(p => p.policyId === selection.policyId);
    if (!policy) return;
    paneHost.append(await renderPolicyPane(policy));
  }

  async function renderPolicyPane(policy: ClassroomPolicy): Promise<HTMLElement> {
    const pane = el("div", {class: "admin2-pane-wrap"});
    const header = el("div", {class: "admin2-pane-header"});
    header.append(
      el("h3", {class: "admin2-pane-title"}, policy.title),
      policyStatusBadge(policy.status),
      el("span", {class: "admin2-pane-meta"}, policy.policyId),
    );
    const headerActions = el("div", {class: "admin2-pane-header-actions"});
    const duplicateBtn = el(
      "button",
      {type: "button", class: "admin2-btn admin2-btn-sm"},
      "複製",
    );
    const deleteBtn = el(
      "button",
      {type: "button", class: "admin2-btn admin2-btn-danger admin2-btn-sm"},
      "削除",
    );
    headerActions.append(duplicateBtn, deleteBtn);
    header.append(headerActions);

    const body = el("div", {class: "admin2-pane-body"});
    body.append(await buildLinksCard(policy));
    body.append(buildFeaturesCard(policy));
    body.append(
      mountPolicyRosterControls(
        policy,
        rosters,
        classroomFlags,
        getCsrf,
        saveFooter,
        refreshAll,
      ),
    );

    const submissionsHost = el("div");
    const linkedRoster = rosters.find(r => r.rosterId === policy.rosterId);
    await mountPolicySubmissionsPanel(
      submissionsHost,
      policy,
      classroomFlags,
      linkedRoster?.studentCount,
    );
    body.append(submissionsHost);

    pane.append(header, body, saveFooter.root);

    duplicateBtn.addEventListener("click", () => {
      void (async () => {
        await adminFetch(ADMIN_POLICIES_PATH, {
          method: "POST",
          csrfToken: getCsrf(),
          body: JSON.stringify({
            title: `${policy.title}（複製）`,
            aiAssist: policy.aiAssist,
            editor: policy.editor,
            collab: policy.collab,
            drive: policy.drive,
            rosterId: policy.rosterId,
            studentAuth: policy.studentAuth,
            submission: policy.submission,
          }),
        });
        saveFooter.setSaved();
        await refreshAll();
      })();
    });

    deleteBtn.addEventListener("click", () => {
      void (async () => {
        await adminFetch(adminPolicyPath(policy.policyId), {
          method: "PATCH",
          csrfToken: getCsrf(),
          body: JSON.stringify({status: "disabled"}),
        });
        saveFooter.setSaved();
        await refreshAll();
      })();
    });

    return pane;
  }

  async function buildLinksCard(policy: ClassroomPolicy): Promise<HTMLElement> {
    const card = el("div", {class: "admin2-card"});
    const header = el("div", {class: "admin2-card-header"});
    const activeLinks: StudentLinkListItem[] = [];
    const linkRes = await adminFetch<{ok: boolean; links: StudentLinkListItem[]}>(
      adminLinksForPolicyPath(policy.policyId),
    );
    if (linkRes.ok) {
      for (const link of linkRes.links) {
        if (link.status === "active") activeLinks.push(link);
      }
    }

    header.append(
      el("h4", {class: "admin2-card-title"}, "生徒用リンク"),
      el("span", {class: "admin2-card-hint"}, `配布中 ${activeLinks.length} 件`),
    );
    const createLinkBtn = el(
      "button",
      {
        type: "button",
        class: "admin2-btn admin2-btn-primary admin2-btn-sm",
        "data-testid": "admin-create-link",
        style: "margin-left:auto",
      },
      "＋ リンクを作る",
    );
    header.append(createLinkBtn);

    const expiryRow = el("div", {
      class: "admin2-row admin2-row-label-policy",
      style: "padding:7px 14px 10px;border-top:1px solid #e6ecf3",
    });
    expiryRow.append(el("span", {class: "admin2-row-label"}, "有効期限"));
    const expiryWrap = el("div", {class: "admin2-row-value"});
    const expiryInput = el("input", {
      type: "datetime-local",
      class: "admin2-input",
      "data-testid": "admin-link-expiry",
    }) as HTMLInputElement;
    expiryWrap.append(
      expiryInput,
      el("span", {style: "font-size:11px;color:#5b708a"}, "未設定＝無期限"),
    );
    expiryRow.append(expiryWrap);

    const linksBody = el("div", {class: "admin2-card-body is-flush"});
    card.append(header, linksBody, expiryRow);

    function resolveStudentUrl(link: StudentLinkListItem): string {
      if (link.studentUrl) {
        linkUrlCache.set(link.linkId, link.studentUrl);
        return link.studentUrl;
      }
      const cached = linkUrlCache.get(link.linkId);
      if (cached) return cached;
      if (link.token) {
        const url = `${window.location.origin}${studentSurfacePath(link.token)}`;
        linkUrlCache.set(link.linkId, url);
        return url;
      }
      return "";
    }

    function renderLinks(): void {
      linksBody.replaceChildren();
      if (activeLinks.length === 0) {
        linksBody.append(el("div", {class: "admin2-link-row"}, emptyValue()));
        hiddenLinkOut.textContent = "なし";
        return;
      }
      for (const link of activeLinks) {
        const row = el("div", {class: "admin2-link-row"});
        row.append(createBadge("配布中", "success"));
        const studentUrl = resolveStudentUrl(link);
        const urlEl = el(
          "span",
          {class: "admin2-link-url"},
          studentUrl || "なし",
        );
        row.append(urlEl);
        if (studentUrl) hiddenLinkOut.textContent = studentUrl;

        const actions = el("div", {class: "admin2-row-actions"});
        const copyBtn = el(
          "button",
          {type: "button", class: "admin2-btn admin2-btn-secondary admin2-btn-sm"},
          "コピー",
        );
        copyBtn.addEventListener("click", () => {
          if (!studentUrl) return;
          void navigator.clipboard.writeText(studentUrl);
          saveFooter.setSaved();
        });
        const qrBtn = el(
          "button",
          {type: "button", class: "admin2-btn admin2-btn-sm"},
          "QR",
        );
        qrBtn.addEventListener("click", () => {
          if (!studentUrl) return;
          window.open(buildQrImageUrl(studentUrl), "_blank", "noopener,noreferrer");
        });
        const revokeBtn = el(
          "button",
          {type: "button", class: "admin2-btn admin2-btn-danger admin2-btn-sm"},
          "失効",
        );
        revokeBtn.addEventListener("click", () => {
          void (async () => {
            await adminFetch(adminLinkRevokePath(link.linkId), {
              method: "POST",
              csrfToken: getCsrf(),
            });
            saveFooter.setSaved();
            const idx = activeLinks.indexOf(link);
            if (idx >= 0) activeLinks.splice(idx, 1);
            renderLinks();
            header.querySelector(".admin2-card-hint")!.textContent =
              `配布中 ${activeLinks.length} 件`;
          })();
        });
        actions.append(copyBtn, qrBtn, revokeBtn);
        row.append(actions);
        linksBody.append(row);
      }
    }

    createLinkBtn.addEventListener("click", () => {
      void (async () => {
        const expiresAt = expiryInput.value
          ? new Date(expiryInput.value).toISOString()
          : null;
        const res = await adminFetch<{
          ok: boolean;
          link?: StudentLinkListItem;
          message?: string;
        }>(adminLinksForPolicyPath(policy.policyId), {
          method: "POST",
          csrfToken: getCsrf(),
          body: JSON.stringify({label: "授業用", expiresAt}),
        });
        if (!res.ok || !res.link) {
          saveFooter.setError(res.message || "リンクを作れませんでした。");
          return;
        }
        if (res.link.studentUrl) {
          linkUrlCache.set(res.link.linkId, res.link.studentUrl);
          hiddenLinkOut.textContent = res.link.studentUrl;
        }
        activeLinks.unshift(res.link);
        renderLinks();
        header.querySelector(".admin2-card-hint")!.textContent =
          `配布中 ${activeLinks.length} 件`;
        saveFooter.setSaved();
      })();
    });

    renderLinks();
    return card;
  }

  function buildFeaturesCard(policy: ClassroomPolicy): HTMLElement {
    const card = el("div", {class: "admin2-card"});
    const header = el("div", {class: "admin2-card-header"});
    header.append(
      el("h4", {class: "admin2-card-title"}, "この教室で許可する機能"),
      el(
        "span",
        {class: "admin2-card-hint"},
        "変更は配布中のリンクに即時反映されます",
      ),
    );
    const body = el("div", {class: "admin2-card-body"});

    let aiEnabled = policy.aiAssist.enabled;
    let showSettings = policy.editor.showSettingsPanel;
    let allowExtensions = policy.editor.allowExtensions ?? false;

    function addSegmentRow(
      label: string,
      options: Array<{label: string; value: string}>,
      getValue: () => string,
      onChange: (value: string) => void,
    ): void {
      const row = el("div", {class: "admin2-row admin2-row-label-policy"});
      row.append(el("span", {class: "admin2-row-label"}, label));
      const valueCol = el("div");
      row.append(valueCol);

      function render(): void {
        valueCol.replaceChildren(
          createSegmentControl(options, getValue(), value => {
            onChange(value);
            render();
          }),
        );
      }
      render();
      body.append(row);
    }

    const saveDebounced = debounce(() => {
      void saveFeatures();
    }, 400);

    async function saveFeatures(): Promise<void> {
      const prev = {
        aiAssist: {...policy.aiAssist},
        editor: {...policy.editor},
      };
      const res = await adminFetch<{ok: boolean; message?: string}>(
        adminPolicyPath(policy.policyId),
        {
          method: "PATCH",
          csrfToken: getCsrf(),
          body: JSON.stringify({
            aiAssist: {
              enabled: aiEnabled,
              allowStudentApiKey: policy.aiAssist.allowStudentApiKey,
            },
            editor: {
              showSettingsPanel: showSettings,
              allowExtensions,
            },
          }),
        },
      );
      if (!res.ok) {
        saveFooter.setError(res.message || "設定の保存に失敗しました。");
        return;
      }
      saveFooter.pushUndo(async () => {
        await adminFetch(adminPolicyPath(policy.policyId), {
          method: "PATCH",
          csrfToken: getCsrf(),
          body: JSON.stringify(prev),
        });
        aiEnabled = prev.aiAssist.enabled;
        showSettings = prev.editor.showSettingsPanel;
        allowExtensions = prev.editor.allowExtensions ?? false;
        await refreshAll();
      });
      policy.aiAssist.enabled = aiEnabled;
      policy.editor.showSettingsPanel = showSettings;
      policy.editor.allowExtensions = allowExtensions;
      saveFooter.setSaved();
    }

    addSegmentRow(
      "AI",
      [
        {label: "許可", value: "allow"},
        {label: "禁止", value: "deny"},
      ],
      () => (aiEnabled ? "allow" : "deny"),
      value => {
        aiEnabled = value === "allow";
        saveDebounced();
      },
    );
    addSegmentRow(
      "生徒の設定パネル",
      [
        {label: "表示", value: "show"},
        {label: "非表示", value: "hide"},
      ],
      () => (showSettings ? "show" : "hide"),
      value => {
        showSettings = value === "show";
        saveDebounced();
      },
    );
    addSegmentRow(
      "拡張機能ギャラリー",
      [
        {label: "許可", value: "allow"},
        {label: "禁止", value: "deny"},
      ],
      () => (allowExtensions ? "allow" : "deny"),
      value => {
        allowExtensions = value === "allow";
        saveDebounced();
      },
    );

    card.append(header, body);
    return card;
  }

  await refreshAll();
}
