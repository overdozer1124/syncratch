import {
  ADMIN_GOOGLE_OAUTH_DISCONNECT_PATH,
  ADMIN_GOOGLE_OAUTH_SESSION_PATH,
  ADMIN_GOOGLE_OAUTH_START_PATH,
  ADMIN_POLICIES_PATH,
  ADMIN_ROSTERS_PATH,
  ADMIN_GOOGLE_OAUTH_RETURN_FLAG,
  ADMIN_GOOGLE_OAUTH_RETURN_REASON,
  ROSTER_SHEET_COLUMNS,
  adminRosterImportApplyPath,
  adminRosterImportsPath,
  adminRosterPath,
  adminRosterSheetTemplatePath,
  adminRosterStudentsPath,
  adminRosterSyncApplyPath,
  adminRosterSyncPath,
  type ClassroomPolicy,
  type ClassroomRoster,
  type ClassroomRosterListItem,
  type ClassroomStudentListItem,
  type RosterImportPreview,
  type RosterImportPreviewCategory,
} from "@blocksync/classroom-access";
import type {AdminClassroomFlags} from "./admin-classroom-flags.js";
import {
  adminFetch,
  createBadge,
  createFilePicker,
  createSegmentControl,
  debounce,
  el,
  emptyValue,
  formatShortTimestamp,
  truncateMiddle,
  type AdminSaveFooterController,
} from "./admin-console-shared.js";

const CATEGORY_LABELS: Record<RosterImportPreviewCategory, string> = {
  add: "追加",
  update: "更新",
  unchanged: "変更なし",
  deactivate: "無効化",
  duplicate_candidate: "重複候補",
  attendance_collision: "出席番号衝突",
  rejected_row: "拒否",
};

export interface AdminPaneContext {
  getCsrf: () => string;
  flags: AdminClassroomFlags | null;
  saveFooter: AdminSaveFooterController;
  onRefresh: () => Promise<void>;
  rosters: ClassroomRosterListItem[];
  adminEmail: string;
}

export function buildSpreadsheetEditUrl(spreadsheetId: string): string {
  const id = spreadsheetId.trim();
  if (!id) return "";
  return `https://docs.google.com/spreadsheets/d/${encodeURIComponent(id)}/edit`;
}

export async function fetchAdminRosterList(): Promise<ClassroomRosterListItem[]> {
  const res = await adminFetch<{ok: boolean; rosters?: ClassroomRosterListItem[]}>(
    ADMIN_ROSTERS_PATH,
  );
  return res.ok ? (res.rosters ?? []) : [];
}

function summarizePreview(preview: RosterImportPreview): string {
  const counts = new Map<string, number>();
  for (const row of preview.rows) {
    counts.set(row.category, (counts.get(row.category) ?? 0) + 1);
  }
  const parts: string[] = [];
  for (const [category, count] of counts) {
    const label = CATEGORY_LABELS[category as RosterImportPreviewCategory] ?? category;
    parts.push(`${label} ${count}`);
  }
  return parts.join(" / ") || "変更なし";
}

function clearOAuthReturnQuery(): void {
  const url = new URL(window.location.href);
  if (
    !url.searchParams.has(ADMIN_GOOGLE_OAUTH_RETURN_FLAG) &&
    !url.searchParams.has(ADMIN_GOOGLE_OAUTH_RETURN_REASON)
  ) {
    return;
  }
  url.searchParams.delete(ADMIN_GOOGLE_OAUTH_RETURN_FLAG);
  url.searchParams.delete(ADMIN_GOOGLE_OAUTH_RETURN_REASON);
  window.history.replaceState({}, "", url.pathname + url.search + url.hash);
}

function oauthFailureMessage(reason: string | null): string {
  switch (reason) {
    case "missing_refresh_token":
      return "Google 連携に失敗しました。Google アカウント設定で Syncratch のアクセスを削除してから、もう一度お試しください。";
    case "pending_expired":
      return "Google 連携の準備状態が失効しました。/admin からもう一度連携してください。";
    case "google_denied":
      return "Google 側で連携がキャンセルまたは拒否されました。";
    case "scope_denied":
      return "Google Drive（drive.file）へのアクセスが許可されませんでした。";
    case "token_exchange_failed":
      return "Google トークン交換に失敗しました。GOOGLE_CLIENT_SECRET と redirect URI を確認してください。";
    case "admin_account_not_found":
      return "管理者セッションが無効です。ログアウトして /admin から再ログインしてください。";
    default:
      return "Google 連携に失敗しました。もう一度お試しください。";
  }
}

function studentStatusBadge(student: ClassroomStudentListItem): HTMLElement {
  if (!student.active) {
    return createBadge("無効", "neutral");
  }
  if (student.accountStatus === "pending_activation" || !student.accountStatus) {
    return createBadge("未登録", "warn");
  }
  return createBadge("active", "success");
}

function rosterSyncBadge(syncStatus: string): HTMLElement {
  if (syncStatus === "sync_required") {
    return createBadge("要確認", "warn");
  }
  return createBadge("同期 active", "success");
}

function renderPreviewBox(
  container: HTMLElement,
  preview: RosterImportPreview,
  onApply: (deactivateMissing: boolean) => Promise<void>,
): void {
  container.replaceChildren();
  container.append(el("p", {class: "admin2-feedback"}, summarizePreview(preview)));

  const table = el("table", {class: "admin2-table"});
  const head = el("tr");
  for (const label of ["行", "区分", "student_code", "display_name", "メモ"]) {
    head.append(el("th", {}, label));
  }
  table.append(el("thead", {}, undefined), el("tbody"));
  table.querySelector("thead")!.append(head);
  const tbody = table.querySelector("tbody")!;
  for (const row of preview.rows.slice(0, 30)) {
    const tr = el("tr");
    const proposed = row.proposed as {
      student_code?: string;
      display_name?: string;
    };
    const issueText =
      row.issues.length > 0 ? row.issues.map(i => i.message).join("; ") : "なし";
    tr.append(
      el("td", {class: "is-mono"}, String(row.rowNumber)),
      el("td", {}, CATEGORY_LABELS[row.category] ?? row.category),
      el("td", {class: "is-mono"}, proposed.student_code || "なし"),
      el("td", {}, proposed.display_name || "なし"),
      el("td", {}, issueText),
    );
    tbody.append(tr);
  }
  container.append(table);

  const applyBtn = el(
    "button",
    {type: "button", class: "admin2-btn admin2-btn-primary"},
    "プレビューを適用",
  );
  applyBtn.addEventListener("click", () => {
    void onApply(preview.deactivateMissing).catch(error => {
      container.append(
        el(
          "p",
          {class: "admin2-feedback is-error"},
          error instanceof Error ? error.message : "適用に失敗しました。",
        ),
      );
    });
  });
  container.append(applyBtn);
}

function buildConnectionSummary(roster: ClassroomRoster): string {
  if (!roster.sheetSpreadsheetId) return "なし";
  const id = truncateMiddle(roster.sheetSpreadsheetId, 28);
  const tab = roster.sheetTabName || "Sheet1";
  const range = roster.sheetRange || "A:F";
  return `${id} · ${tab} · ${range}`;
}

export function renderAccountPane(ctx: AdminPaneContext): HTMLElement {
  const pane = el("div", {class: "admin2-pane-wrap"});
  const header = el("div", {class: "admin2-pane-header"});
  header.append(
    el("h3", {class: "admin2-pane-title"}, "アカウント"),
    createBadge(ctx.adminEmail, "neutral"),
  );
  const logoutBtn = el(
    "button",
    {type: "button", class: "admin2-btn admin2-btn-sm"},
    "ログアウト",
  );
  logoutBtn.addEventListener("click", () => {
    document.dispatchEvent(new CustomEvent("admin2-logout"));
  });
  header.append(el("div", {class: "admin2-pane-header-actions"}, undefined));
  header.querySelector(".admin2-pane-header-actions")!.append(logoutBtn);

  const body = el("div", {class: "admin2-pane-body is-flat"});
  const credentialRow = el("div", {
    class: "admin2-row admin2-row-label-account",
    "data-testid": "admin-roster-credential",
  });
  credentialRow.append(el("span", {class: "admin2-row-label"}, "Google 連携"));

  const valueCol = el("div", {class: "admin2-row-value"});
  const actionsCol = el("div", {class: "admin2-row-actions"});
  credentialRow.append(valueCol, actionsCol);

  const dependentRow = el("div", {class: "admin2-row admin2-row-label-account-2"});
  dependentRow.append(
    el("span", {class: "admin2-row-label"}, "連携中の名簿"),
    el("div", {class: "admin2-chip-list"}),
  );

  const permissionRow = el("div", {class: "admin2-row admin2-row-label-account-2"});
  permissionRow.append(
    el("span", {class: "admin2-row-label"}, "権限"),
    el(
      "span",
      {},
      "管理者",
      el("span", {style: "font-size:11px;color:#5b708a"}, " — 教室設定・名簿の作成と削除ができます"),
    ),
  );

  body.append(credentialRow, dependentRow, permissionRow);
  pane.append(header, body, ctx.saveFooter.root);

  const chipList = dependentRow.querySelector(".admin2-chip-list")!;
  const sheetRosters = ctx.rosters.filter(
    r => r.syncStatus === "active" || r.syncStatus === "sync_required",
  );

  async function refreshCredential(): Promise<void> {
    valueCol.replaceChildren();
    actionsCol.replaceChildren();
    chipList.replaceChildren();

    if (!ctx.flags?.adminGoogleCredentialEnabled) {
      valueCol.append(emptyValue());
      return;
    }

    const oauthFlag = new URL(window.location.href).searchParams.get(
      ADMIN_GOOGLE_OAUTH_RETURN_FLAG,
    );
    if (oauthFlag === "ok") {
      ctx.saveFooter.setSaved();
      clearOAuthReturnQuery();
    } else if (oauthFlag === "error") {
      const reason = new URL(window.location.href).searchParams.get(
        ADMIN_GOOGLE_OAUTH_RETURN_REASON,
      );
      ctx.saveFooter.setError(oauthFailureMessage(reason));
      clearOAuthReturnQuery();
    }

    const session = await adminFetch<{
      ok: boolean;
      connected?: boolean;
      googleEmail?: string;
    }>(ADMIN_GOOGLE_OAUTH_SESSION_PATH);

    if (session.ok && session.connected) {
      valueCol.append(
        createBadge("連携中", "success"),
        el(
          "span",
          {class: "admin2-input-mono"},
          session.googleEmail ?? ctx.adminEmail,
        ),
        el(
          "span",
          {style: "font-size:11px;color:#5b708a;white-space:nowrap"},
          "名簿 Sheet の読み取り / 提出物の書き出しに使用",
        ),
      );
      actionsCol.append(
        el(
          "button",
          {type: "button", class: "admin2-btn admin2-btn-sm"},
          "別のアカウントで連携",
        ),
        el(
          "button",
          {type: "button", class: "admin2-btn admin2-btn-danger admin2-btn-sm"},
          "連携を解除",
        ),
      );
      const reconnect = actionsCol.firstElementChild as HTMLButtonElement;
      reconnect.addEventListener("click", () => {
        window.location.href = `${ADMIN_GOOGLE_OAUTH_START_PATH}?return=${encodeURIComponent("/admin")}`;
      });
      const disconnect = actionsCol.lastElementChild as HTMLButtonElement;
      disconnect.addEventListener("click", () => {
        void (async () => {
          const prevEmail = session.googleEmail;
          await adminFetch(ADMIN_GOOGLE_OAUTH_DISCONNECT_PATH, {
            method: "POST",
            csrfToken: ctx.getCsrf(),
          });
          ctx.saveFooter.pushUndo(async () => {
            window.location.href = `${ADMIN_GOOGLE_OAUTH_START_PATH}?return=${encodeURIComponent("/admin")}`;
            void prevEmail;
          });
          ctx.saveFooter.setSaved();
          await refreshCredential();
          await ctx.onRefresh();
        })();
      });

      for (const roster of sheetRosters) {
        chipList.append(createBadge(roster.title, "info"));
      }
      if (sheetRosters.length > 0) {
        chipList.append(
          el(
            "span",
            {style: "font-size:11px;color:#5b708a;white-space:nowrap"},
            `解除するとこの${sheetRosters.length}件の Sheet 同期が停止します`,
          ),
        );
      } else {
        chipList.append(emptyValue());
      }
    } else {
      valueCol.append(emptyValue());
      const connect = el(
        "button",
        {type: "button", class: "admin2-btn admin2-btn-primary admin2-btn-sm"},
        "Google と連携",
      );
      connect.addEventListener("click", () => {
        window.location.href = `${ADMIN_GOOGLE_OAUTH_START_PATH}?return=${encodeURIComponent("/admin")}`;
      });
      actionsCol.append(connect);
      chipList.append(emptyValue());
    }
  }

  void refreshCredential();
  return pane;
}

export async function renderRosterPane(
  ctx: AdminPaneContext,
  rosterId: string,
): Promise<HTMLElement | null> {
  const summary = ctx.rosters.find(r => r.rosterId === rosterId);
  const detailRes = await adminFetch<{ok: boolean; roster?: ClassroomRoster}>(
    adminRosterPath(rosterId),
  );
  const roster = detailRes.roster;
  if (!roster || !summary) return null;

  const pane = el("div", {class: "admin2-pane-wrap"});
  const header = el("div", {class: "admin2-pane-header"});
  header.append(
    el("h3", {class: "admin2-pane-title"}, roster.title),
    rosterSyncBadge(roster.syncStatus),
    el(
      "span",
      {class: "admin2-pane-meta"},
      `revision ${roster.rosterRevision} · ${summary.studentCount}名`,
    ),
  );
  const headerActions = el("div", {class: "admin2-pane-header-actions"});
  const syncNowBtn = el(
    "button",
    {type: "button", class: "admin2-btn admin2-btn-secondary admin2-btn-sm"},
    "今すぐ同期",
  );
  const deleteBtn = el(
    "button",
    {type: "button", class: "admin2-btn admin2-btn-danger admin2-btn-sm"},
    "削除",
  );
  headerActions.append(syncNowBtn, deleteBtn);
  header.append(headerActions);

  const body = el("div", {class: "admin2-pane-body"});
  const connectionCard = el("div", {class: "admin2-card"});
  const connectionRow = el("div", {class: "admin2-row admin2-row-label-roster"});
  connectionRow.append(el("span", {class: "admin2-row-label"}, "接続"));
  const connectionValue = el("div", {class: "admin2-row-value"});
  const connectionActions = el("div", {class: "admin2-row-actions"});
  connectionRow.append(connectionValue, connectionActions);

  const expandPanel = el("div", {class: "admin2-card-body", hidden: "true"});
  const sheetIdInput = el("input", {
    type: "text",
    class: "admin2-input admin2-input-mono",
    placeholder: "スプレッドシート ID",
    value: roster.sheetSpreadsheetId ?? "",
  }) as HTMLInputElement;
  const tabInput = el("input", {
    type: "text",
    class: "admin2-input",
    placeholder: "Sheet1",
    value: roster.sheetTabName ?? "Sheet1",
  }) as HTMLInputElement;
  const rangeInput = el("input", {
    type: "text",
    class: "admin2-input admin2-input-mono",
    placeholder: "A:F",
    value: roster.sheetRange ?? "",
  }) as HTMLInputElement;

  for (const [label, input] of [
    ["スプレッドシート ID", sheetIdInput],
    ["シート名", tabInput],
    ["範囲", rangeInput],
  ] as const) {
    const row = el("div", {class: "admin2-row admin2-row-label-roster"});
    row.append(el("span", {class: "admin2-row-label"}, label), input);
    expandPanel.append(row);
  }

  const openSheetBtn = el(
    "a",
    {
      class: "admin2-btn admin2-btn-secondary admin2-btn-sm admin-roster-open-sheet",
      "data-testid": "admin-roster-open-sheet",
      target: "_blank",
      rel: "noopener noreferrer",
      hidden: roster.sheetSpreadsheetId ? undefined : "true",
      href: buildSpreadsheetEditUrl(roster.sheetSpreadsheetId ?? ""),
    },
    "Sheet を開く ↗",
  ) as HTMLAnchorElement;

  const toggleExpandBtn = el(
    "button",
    {type: "button", class: "admin2-btn admin2-btn-sm"},
    "接続を変更",
  );

  function refreshConnectionSummary(): void {
    connectionValue.replaceChildren();
    if (!sheetIdInput.value.trim()) {
      connectionValue.append(emptyValue());
      openSheetBtn.hidden = true;
      return;
    }
    connectionValue.append(
      createBadge("Google Sheet", "success"),
      el(
        "span",
        {class: "admin2-input-mono", style: "color:#5b708a"},
        buildConnectionSummary({
          ...roster,
          sheetSpreadsheetId: sheetIdInput.value.trim(),
          sheetTabName: tabInput.value.trim() || "Sheet1",
          sheetRange: rangeInput.value.trim() || "A:F",
        }),
      ),
      el(
        "span",
        {style: "font-size:11px;color:#5b708a;white-space:nowrap"},
        `最終 ${formatShortTimestamp(roster.updatedAt)}`,
      ),
    );
    openSheetBtn.href = buildSpreadsheetEditUrl(sheetIdInput.value);
    openSheetBtn.hidden = false;
  }

  toggleExpandBtn.addEventListener("click", () => {
    expandPanel.hidden = !expandPanel.hidden;
  });

  connectionActions.append(openSheetBtn, toggleExpandBtn);
  connectionCard.append(connectionRow, expandPanel);

  const studentsCard = el("div", {
    class: "admin2-card admin-roster-card",
    "data-testid": "admin-roster-card",
  });
  const studentsHeader = el("div", {class: "admin2-card-header"});
  studentsHeader.append(
    el("h4", {class: "admin2-card-title"}, "生徒"),
    el("span", {class: "admin2-card-hint"}, `${summary.studentCount} 名`),
  );
  const filterInput = el("input", {
    type: "text",
    class: "admin2-input",
    placeholder: "氏名・ログイン名で絞り込み",
    style: "margin-left:10px;width:16rem",
  }) as HTMLInputElement;
  studentsHeader.append(filterInput);
  const studentsActions = el("div", {class: "admin2-row-actions", style: "margin-left:auto"});
  const exportCsvBtn = el(
    "button",
    {type: "button", class: "admin2-btn admin2-btn-sm"},
    "CSV で書き出す",
  );
  const addStudentBtn = el(
    "button",
    {type: "button", class: "admin2-btn admin2-btn-primary admin2-btn-sm"},
    "＋ 生徒を追加",
  );
  studentsActions.append(exportCsvBtn, addStudentBtn);
  studentsHeader.append(studentsActions);

  const previewHost = el("div", {class: "admin2-card-body"});
  const csvPicker = createFilePicker(".csv,text/csv", "CSV で取り込む", file => {
    void uploadCsvPreview(file);
  });
  studentsHeader.insertBefore(csvPicker.root, studentsActions);

  const studentsTableHost = el("div", {class: "admin2-card-body is-flush"});
  studentsCard.append(studentsHeader, previewHost, studentsTableHost);

  body.append(connectionCard, studentsCard);
  pane.append(header, body, ctx.saveFooter.root);

  const saveSheetDebounced = debounce(() => {
    void saveSheetSettings();
  }, 400);

  for (const input of [sheetIdInput, tabInput, rangeInput]) {
    input.addEventListener("input", () => {
      refreshConnectionSummary();
      saveSheetDebounced();
    });
  }
  refreshConnectionSummary();

  async function saveSheetSettings(): Promise<void> {
    const prev = {
      sheetSpreadsheetId: roster.sheetSpreadsheetId,
      sheetTabName: roster.sheetTabName,
      sheetRange: roster.sheetRange,
    };
    const next = {
      sheetSpreadsheetId: sheetIdInput.value.trim() || null,
      sheetTabName: tabInput.value.trim() || null,
      sheetRange: rangeInput.value.trim() || null,
    };
    const res = await adminFetch<{ok: boolean; message?: string}>(
      adminRosterPath(rosterId),
      {
        method: "PATCH",
        csrfToken: ctx.getCsrf(),
        body: JSON.stringify(next),
      },
    );
    if (!res.ok) {
      ctx.saveFooter.setError(res.message || "Sheet 設定の保存に失敗しました。");
      return;
    }
    ctx.saveFooter.pushUndo(async () => {
      await adminFetch(adminRosterPath(rosterId), {
        method: "PATCH",
        csrfToken: ctx.getCsrf(),
        body: JSON.stringify(prev),
      });
      await ctx.onRefresh();
    });
    ctx.saveFooter.setSaved();
    Object.assign(roster, next);
    await ctx.onRefresh();
  }

  async function uploadCsvPreview(file: File): Promise<void> {
    previewHost.replaceChildren();
    const csv = await file.text();
    const res = await adminFetch<{ok: boolean; message?: string} & RosterImportPreview>(
      adminRosterImportsPath(rosterId),
      {
        method: "POST",
        csrfToken: ctx.getCsrf(),
        body: JSON.stringify({csv, deactivateMissing: false}),
      },
    );
    if (!res.ok || !res.import) {
      ctx.saveFooter.setError(res.message || "CSV プレビューに失敗しました。");
      return;
    }
    renderPreviewBox(previewHost, res, async deactivateMissing => {
      const applyRes = await adminFetch<{ok: boolean; message?: string}>(
        adminRosterImportApplyPath(rosterId, res.import.importId),
        {
          method: "POST",
          csrfToken: ctx.getCsrf(),
          body: JSON.stringify({
            previewHash: res.previewHash,
            baseRosterRevision: res.baseRosterRevision,
            deactivateMissing,
          }),
        },
      );
      if (!applyRes.ok) {
        throw new Error(applyRes.message || "CSV 適用に失敗しました。");
      }
      previewHost.replaceChildren();
      ctx.saveFooter.setSaved();
      await refreshStudents();
      await ctx.onRefresh();
    });
  }

  async function refreshStudents(): Promise<void> {
    const res = await adminFetch<{
      ok: boolean;
      students?: ClassroomStudentListItem[];
    }>(adminRosterStudentsPath(rosterId));
    studentsTableHost.replaceChildren();
    if (!res.ok || !res.students?.length) {
      const table = el("table", {class: "admin2-table admin-roster-student-table"});
      table.append(
        el("thead", {}, undefined),
        el("tbody", {}, undefined),
      );
      const headRow = el("tr");
      for (const label of [
        "出席番号",
        "氏名",
        "ログイン名",
        "グループ",
        "初回登録",
        "状態",
      ]) {
        headRow.append(el("th", {}, label));
      }
      table.querySelector("thead")!.append(headRow);
      const emptyRow = el("tr");
      emptyRow.append(el("td", {colspan: "6", class: "is-empty"}, "なし"));
      table.querySelector("tbody")!.append(emptyRow);
      studentsTableHost.append(table);
      return;
    }

    const filter = filterInput.value.trim().toLowerCase();
    const rows = res.students.filter(student => {
      if (!filter) return true;
      return (
        student.displayName.toLowerCase().includes(filter) ||
        (student.loginName ?? "").toLowerCase().includes(filter)
      );
    });

    const table = el("table", {class: "admin2-table admin-roster-student-table"});
    const headRow = el("tr");
    for (const label of [
      "出席番号",
      "氏名",
      "ログイン名",
      "グループ",
      "初回登録",
      "状態",
    ]) {
      headRow.append(el("th", {}, label));
    }
    table.append(el("thead", {}, undefined), el("tbody"));
    table.querySelector("thead")!.append(headRow);
    const tbody = table.querySelector("tbody")!;
    for (const student of rows) {
      const tr = el("tr");
      tr.append(
        el(
          "td",
          {class: "is-mono"},
          student.attendanceNumber ?? emptyValue().textContent!,
        ),
        el("td", {}, student.displayName || "なし"),
        el(
          "td",
          {class: "is-mono"},
          student.loginName ? student.loginName : (emptyValue().textContent ?? "なし"),
        ),
        el("td", {}, student.groupLabel || "なし"),
        el(
          "td",
          {class: student.accountStatus ? "is-mono" : "is-empty"},
          student.accountStatus ? formatShortTimestamp(student.createdAt) : "なし",
        ),
        el("td", {}, undefined),
      );
      tr.lastElementChild!.append(studentStatusBadge(student));
      tbody.append(tr);
    }
    studentsTableHost.append(table);
  }

  filterInput.addEventListener("input", () => {
    void refreshStudents();
  });

  exportCsvBtn.addEventListener("click", () => {
    void (async () => {
      const res = await adminFetch<{
        ok: boolean;
        students?: ClassroomStudentListItem[];
      }>(adminRosterStudentsPath(rosterId));
      if (!res.ok || !res.students?.length) return;
      const header = [
        "student_code",
        "display_name",
        "attendance_number",
        "login_name",
        "group_label",
        "active",
      ];
      const lines = [
        header.join(","),
        ...res.students.map(s =>
          [
            s.studentCode,
            s.displayName,
            s.attendanceNumber ?? "",
            s.loginName ?? "",
            s.groupLabel ?? "",
            s.active ? "1" : "0",
          ]
            .map(v => `"${String(v).replace(/"/g, '""')}"`)
            .join(","),
        ),
      ];
      const blob = new Blob([lines.join("\n")], {type: "text/csv;charset=utf-8"});
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = `${roster.title}.csv`;
      anchor.click();
      URL.revokeObjectURL(url);
    })();
  });

  syncNowBtn.addEventListener("click", () => {
    void (async () => {
      previewHost.replaceChildren();
      const res = await adminFetch<
        {ok: boolean; message?: string; code?: string} & RosterImportPreview
      >(adminRosterSyncPath(rosterId), {
        method: "POST",
        csrfToken: ctx.getCsrf(),
        body: JSON.stringify({deactivateMissing: false}),
      });
      if (!res.ok || !res.import) {
        ctx.saveFooter.setError(
          res.message ||
            (res.code === "CREDENTIAL_MISSING"
              ? "教員 Google 連携が必要です。"
              : "Sheet 同期プレビューに失敗しました。"),
        );
        return;
      }
      renderPreviewBox(previewHost, res, async deactivateMissing => {
        const applyRes = await adminFetch<{ok: boolean; message?: string}>(
          adminRosterSyncApplyPath(rosterId),
          {
            method: "POST",
            csrfToken: ctx.getCsrf(),
            body: JSON.stringify({
              importId: res.import.importId,
              previewHash: res.previewHash,
              baseRosterRevision: res.baseRosterRevision,
              deactivateMissing,
            }),
          },
        );
        if (!applyRes.ok) {
          throw new Error(applyRes.message || "Sheet 同期の適用に失敗しました。");
        }
        previewHost.replaceChildren();
        ctx.saveFooter.setSaved();
        await refreshStudents();
        await ctx.onRefresh();
      });
    })();
  });

  if (ctx.flags?.rosterSheetsEnabled) {
    const templateBtn = el(
      "button",
      {type: "button", class: "admin2-btn admin2-btn-sm"},
      "テンプレート Sheet を作成",
    );
    templateBtn.addEventListener("click", () => {
      void (async () => {
        const res = await adminFetch<{
          ok: boolean;
          message?: string;
          template?: {spreadsheetId: string; sheetTabName: string};
        }>(adminRosterSheetTemplatePath(rosterId), {
          method: "POST",
          csrfToken: ctx.getCsrf(),
        });
        if (!res.ok || !res.template) {
          ctx.saveFooter.setError(res.message || "テンプレート Sheet の作成に失敗しました。");
          return;
        }
        sheetIdInput.value = res.template.spreadsheetId;
        tabInput.value = res.template.sheetTabName;
        rangeInput.value = "";
        refreshConnectionSummary();
        saveSheetDebounced();
      })();
    });
    expandPanel.append(
      el("p", {class: "admin2-feedback"}, `列: ${ROSTER_SHEET_COLUMNS.join(", ")}`),
      templateBtn,
    );
  }

  await refreshStudents();
  return pane;
}

export function mountPolicyRosterControls(
  policy: ClassroomPolicy,
  rosters: ClassroomRosterListItem[],
  flags: AdminClassroomFlags | null,
  getCsrf: () => string,
  saveFooter: AdminSaveFooterController,
  onSaved: () => Promise<void>,
): HTMLElement {
  const panel = el("div", {
    class: "admin2-card admin-policy-roster",
    "data-testid": "admin-policy-roster",
  });
  panel.append(
    el("div", {class: "admin2-card-header"}, undefined),
  );
  panel.querySelector(".admin2-card-header")!.append(
    el("h4", {class: "admin2-card-title"}, "名簿と生徒ログイン"),
  );

  const body = el("div", {class: "admin2-card-body"});
  panel.append(body);

  if (!flags?.classroomRosterEnabled) {
    body.append(el("p", {class: "admin2-feedback"}, emptyValue().textContent!));
    return panel;
  }

  const rosterRow = el("div", {class: "admin2-row admin2-row-label-policy-3"});
  rosterRow.append(el("span", {class: "admin2-row-label"}, "紐づける名簿"));
  const rosterSelect = el("select", {
    class: "admin2-select admin-roster-select",
  }) as HTMLSelectElement;
  rosterSelect.append(el("option", {value: ""}, "名簿なし（匿名リンク）"));
  for (const roster of rosters) {
    const opt = el(
      "option",
      {value: roster.rosterId},
      `${roster.title}（${roster.studentCount}名）`,
    );
    if (policy.rosterId === roster.rosterId) opt.selected = true;
    rosterSelect.append(opt);
  }
  const openRosterBtn = el(
    "button",
    {type: "button", class: "admin2-btn admin2-btn-secondary admin2-btn-sm"},
    "名簿を開く",
  );
  rosterRow.append(rosterSelect, openRosterBtn);

  const authRow = el("div", {class: "admin2-row admin2-row-label-policy"});
  authRow.append(el("span", {class: "admin2-row-label"}, "名簿ログイン"));
  const authValue = el("div", {class: "admin2-row-value"});
  authRow.append(authValue);

  body.append(rosterRow, authRow);

  let authRequired = policy.studentAuth.required;

  function renderAuthSegment(): void {
    authValue.replaceChildren(
      createSegmentControl(
        [
          {label: "必須", value: "required"},
          {label: "任意", value: "optional"},
        ],
        authRequired ? "required" : "optional",
        value => {
          authRequired = value === "required";
          renderAuthSegment();
          void saveRosterSettings();
        },
      ),
      el(
        "span",
        {style: "font-size:11px;color:#5b708a"},
        "生徒は初回にログイン名で登録します",
      ),
    );
  }
  renderAuthSegment();

  const saveDebounced = debounce(() => {
    void saveRosterSettings();
  }, 400);

  async function saveRosterSettings(): Promise<void> {
    const prevRosterId = policy.rosterId;
    const prevRequired = policy.studentAuth.required;
    const rosterId = rosterSelect.value || null;
    const res = await adminFetch<{ok: boolean; message?: string}>(
      `${ADMIN_POLICIES_PATH}/${encodeURIComponent(policy.policyId)}`,
      {
        method: "PATCH",
        csrfToken: getCsrf(),
        body: JSON.stringify({
          rosterId,
          studentAuth: {required: authRequired},
        }),
      },
    );
    if (!res.ok) {
      saveFooter.setError(res.message || "名簿設定の保存に失敗しました。");
      return;
    }
    saveFooter.pushUndo(async () => {
      await adminFetch(`${ADMIN_POLICIES_PATH}/${encodeURIComponent(policy.policyId)}`, {
        method: "PATCH",
        csrfToken: getCsrf(),
        body: JSON.stringify({
          rosterId: prevRosterId,
          studentAuth: {required: prevRequired},
        }),
      });
      await onSaved();
    });
    policy.rosterId = rosterId;
    policy.studentAuth.required = authRequired;
    saveFooter.setSaved();
    await onSaved();
  }

  rosterSelect.addEventListener("change", () => {
    saveDebounced();
  });

  openRosterBtn.addEventListener("click", () => {
    if (!rosterSelect.value) return;
    document.dispatchEvent(
      new CustomEvent("admin2-select-roster", {detail: {rosterId: rosterSelect.value}}),
    );
  });

  return panel;
}

export async function mountAdminRostersSection(
  host: HTMLElement,
  getCsrf: () => string,
  flags: AdminClassroomFlags | null,
): Promise<void> {
  host.replaceChildren();
  const section = el("section", {
    class: "admin-rosters-panel",
    "data-testid": "admin-rosters-panel",
  });
  host.append(section);

  if (!flags?.classroomRosterEnabled) {
    section.append(
      el(
        "p",
        {class: "admin2-feedback"},
        "名簿機能はサーバー側で無効です（SYNCRATCH_CLASSROOM_ROSTER_ENABLED=1 が必要）。",
      ),
    );
    return;
  }

  section.append(
    el("p", {class: "admin2-feedback"}, "名簿は左レールから選択してください。"),
  );
  void getCsrf;
}
