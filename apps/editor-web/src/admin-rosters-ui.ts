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

const CATEGORY_LABELS: Record<RosterImportPreviewCategory, string> = {
  add: "追加",
  update: "更新",
  unchanged: "変更なし",
  deactivate: "無効化",
  duplicate_candidate: "重複候補",
  attendance_collision: "出席番号衝突",
  rejected_row: "拒否",
};

async function adminFetch<T>(
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
      return "Google 連携の準備状態が失効しました。/admin からもう一度「Google と連携」を押してください。";
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

export async function fetchAdminRosterList(): Promise<ClassroomRosterListItem[]> {
  const res = await adminFetch<{ok: boolean; rosters?: ClassroomRosterListItem[]}>(
    ADMIN_ROSTERS_PATH,
  );
  return res.ok ? (res.rosters ?? []) : [];
}

async function mountGoogleCredentialPanel(
  host: HTMLElement,
  flags: AdminClassroomFlags,
  getCsrf: () => string,
): Promise<void> {
  if (!flags.adminGoogleCredentialEnabled) return;

  const panel = el("div", {
    class: "admin-roster-credential",
    "data-testid": "admin-roster-credential",
  });
  panel.append(el("h3", {}, "教員 Google 連携（名簿 Sheet / 提出用）"));
  const status = el("p", {class: "admin-muted"});
  const actions = el("div", {class: "admin-roster-actions"});

  const oauthFlag = new URL(window.location.href).searchParams.get(
    ADMIN_GOOGLE_OAUTH_RETURN_FLAG,
  );
  if (oauthFlag === "ok") {
    status.textContent = "Google 連携が完了しました。";
    clearOAuthReturnQuery();
  } else if (oauthFlag === "error") {
    const reason = new URL(window.location.href).searchParams.get(
      ADMIN_GOOGLE_OAUTH_RETURN_REASON,
    );
    status.textContent = oauthFailureMessage(reason);
    clearOAuthReturnQuery();
  }

  async function refreshCredential(): Promise<void> {
    const session = await adminFetch<{
      ok: boolean;
      connected?: boolean;
      googleEmail?: string;
    }>(ADMIN_GOOGLE_OAUTH_SESSION_PATH);
    actions.replaceChildren();
    if (session.ok && session.connected) {
      status.textContent = `連携中: ${session.googleEmail ?? "（メール不明）"}`;
      const disconnect = el(
        "button",
        {type: "button", class: "admin-button"},
        "連携を解除",
      );
      disconnect.addEventListener("click", () => {
        void (async () => {
          await adminFetch(ADMIN_GOOGLE_OAUTH_DISCONNECT_PATH, {
            method: "POST",
            csrfToken: getCsrf(),
          });
          await refreshCredential();
        })();
      });
      actions.append(disconnect);
    } else {
      status.textContent =
        status.textContent ||
        "Google スプレッドシート同期には教員 Google 連携が必要です。";
      const connect = el(
        "button",
        {type: "button", class: "admin-button primary"},
        "Google と連携",
      );
      connect.addEventListener("click", () => {
        const returnTo = encodeURIComponent("/admin");
        window.location.href = `${ADMIN_GOOGLE_OAUTH_START_PATH}?return=${returnTo}`;
      });
      actions.append(connect);
    }
  }

  panel.append(status, actions);
  host.append(panel);
  await refreshCredential();
}

function renderPreviewBox(
  container: HTMLElement,
  preview: RosterImportPreview,
  onApply: (deactivateMissing: boolean) => Promise<void>,
): void {
  container.replaceChildren();
  container.append(
    el("p", {class: "admin-muted"}, summarizePreview(preview)),
  );
  if (preview.ignoredColumns.length > 0) {
    container.append(
      el(
        "p",
        {class: "admin-muted"},
        `無視した列: ${preview.ignoredColumns.join(", ")}`,
      ),
    );
  }
  if (preview.missingFromCsvCount > 0 && !preview.deactivateMissing) {
    container.append(
      el(
        "p",
        {class: "admin-muted"},
        `CSV/Sheet に無い在籍生徒: ${preview.missingFromCsvCount} 名（無効化プレビューなし）`,
      ),
    );
  }

  const table = el("table", {class: "admin-roster-preview-table"});
  const head = el("tr");
  for (const label of ["行", "区分", "student_code", "display_name", "メモ"]) {
    head.append(el("th", {}, label));
  }
  const thead = el("thead");
  thead.append(head);
  table.append(thead);
  const tbody = el("tbody");
  for (const row of preview.rows.slice(0, 30)) {
    const tr = el("tr");
    const proposed = row.proposed as {
      student_code?: string;
      display_name?: string;
    };
    const issueText =
      row.issues.length > 0
        ? row.issues.map(i => i.message).join("; ")
        : "";
    tr.append(
      el("td", {}, String(row.rowNumber)),
      el("td", {}, CATEGORY_LABELS[row.category] ?? row.category),
      el("td", {}, proposed.student_code ?? ""),
      el("td", {}, proposed.display_name ?? ""),
      el("td", {}, issueText),
    );
    tbody.append(tr);
  }
  table.append(tbody);
  container.append(table);
  if (preview.rows.length > 30) {
    container.append(
      el("p", {class: "admin-muted"}, `…他 ${preview.rows.length - 30} 行`),
    );
  }

  const deactivateLabel = el("label", {}, "");
  const deactivateCheck = el("input", {type: "checkbox"}) as HTMLInputElement;
  deactivateCheck.checked = preview.deactivateMissing;
  deactivateLabel.append(
    deactivateCheck,
    document.createTextNode(" CSV/Sheet に無い在籍生徒を無効化する"),
  );
  const applyBtn = el(
    "button",
    {type: "button", class: "admin-button primary"},
    "プレビューを適用",
  );
  applyBtn.addEventListener("click", () => {
    void onApply(deactivateCheck.checked).catch(error => {
      container.append(
        el(
          "p",
          {class: "admin-roster-feedback is-error"},
          error instanceof Error ? error.message : "適用に失敗しました。",
        ),
      );
    });
  });
  container.append(deactivateLabel, applyBtn);
}

async function mountRosterCard(
  host: HTMLElement,
  rosterSummary: ClassroomRosterListItem,
  flags: AdminClassroomFlags,
  getCsrf: () => string,
  onChanged: () => Promise<void>,
): Promise<void> {
  const detailRes = await adminFetch<{ok: boolean; roster?: ClassroomRoster}>(
    adminRosterPath(rosterSummary.rosterId),
  );
  const roster = detailRes.roster;
  if (!roster) return;
  const rosterId = roster.rosterId;

  const card = el("section", {
    class: "admin-roster-card",
    "data-testid": "admin-roster-card",
  });
  card.append(
    el("h3", {}, roster.title),
    el(
      "p",
      {class: "admin-muted"},
      `revision ${roster.rosterRevision} / 同期: ${roster.syncStatus} / 生徒 ${rosterSummary.studentCount} 名`,
    ),
  );

  const feedback = el("p", {
    class: "admin-roster-feedback",
    hidden: "true",
  });

  if (flags.rosterSheetsEnabled) {
    const sheetForm = el("div", {class: "admin-roster-sheet-form"});
    sheetForm.append(el("h4", {}, "Google スプレッドシート"));
    const sheetId = el("input", {
      type: "text",
      class: "admin-roster-input",
      placeholder: "スプレッドシート ID",
      value: roster.sheetSpreadsheetId ?? "",
    }) as HTMLInputElement;
    const tabName = el("input", {
      type: "text",
      class: "admin-roster-input",
      placeholder: "シート名（例: Sheet1）",
      value: roster.sheetTabName ?? "Sheet1",
    }) as HTMLInputElement;
    const sheetRange = el("input", {
      type: "text",
      class: "admin-roster-input",
      placeholder: "範囲（例: A:F または空）",
      value: roster.sheetRange ?? "",
    }) as HTMLInputElement;
    sheetForm.append(
      el(
        "p",
        {class: "admin-muted"},
        "空の Sheet でも構いません。「テンプレート Sheet を作成」でヘッダー行入りのスプレッドシートを自動作成できます。",
      ),
      el("p", {class: "admin-muted"}, `列: ${ROSTER_SHEET_COLUMNS.join(", ")}`),
      sheetId,
      tabName,
      sheetRange,
    );
    const templateLink = el("p", {
      class: "admin-roster-sheet-link admin-muted",
      hidden: "true",
    });
    const createTemplateBtn = el(
      "button",
      {type: "button", class: "admin-button primary"},
      "テンプレート Sheet を作成",
    );
    createTemplateBtn.addEventListener("click", () => {
      void (async () => {
        feedback.hidden = true;
        templateLink.hidden = true;
        const res = await adminFetch<{
          ok: boolean;
          message?: string;
          code?: string;
          template?: {
            spreadsheetId: string;
            spreadsheetUrl: string;
            sheetTabName: string;
          };
          roster?: ClassroomRoster;
        }>(adminRosterSheetTemplatePath(roster.rosterId), {
          method: "POST",
          csrfToken: getCsrf(),
        });
        if (!res.ok || !res.template) {
          feedback.hidden = false;
          feedback.textContent =
            res.message ||
            (res.code === "CREDENTIAL_MISSING"
              ? "教員 Google 連携が必要です。"
              : res.code === "SHEET_CREATE_FAILED"
                ? "スプレッドシートの作成に失敗しました。Google Sheets API が有効か確認してください。"
                : "テンプレート Sheet の作成に失敗しました。");
          feedback.classList.add("is-error");
          return;
        }
        sheetId.value = res.template.spreadsheetId;
        tabName.value = res.template.sheetTabName;
        sheetRange.value = "";
        templateLink.hidden = false;
        templateLink.replaceChildren();
        templateLink.append(
          document.createTextNode("作成しました: "),
          el(
            "a",
            {
              href: res.template.spreadsheetUrl,
              target: "_blank",
              rel: "noopener noreferrer",
            },
            "スプレッドシートを開く",
          ),
        );
        feedback.hidden = false;
        feedback.textContent =
          "テンプレート Sheet を作成し、名簿に紐づけました。2行目以降に生徒データを入力してください。";
        feedback.classList.remove("is-error");
        await onChanged();
      })();
    });
    const saveSheet = el(
      "button",
      {type: "button", class: "admin-button"},
      "Sheet 設定を保存",
    );
    saveSheet.addEventListener("click", () => {
      void (async () => {
        feedback.hidden = true;
        const res = await adminFetch<{ok: boolean; message?: string}>(
          adminRosterPath(roster.rosterId),
          {
            method: "PATCH",
            csrfToken: getCsrf(),
            body: JSON.stringify({
              sheetSpreadsheetId: sheetId.value.trim() || null,
              sheetTabName: tabName.value.trim() || null,
              sheetRange: sheetRange.value.trim() || null,
            }),
          },
        );
        if (!res.ok) {
          feedback.hidden = false;
          feedback.textContent = res.message || "Sheet 設定の保存に失敗しました。";
          feedback.classList.add("is-error");
          return;
        }
        feedback.hidden = false;
        feedback.textContent = "Sheet 設定を保存しました。";
        feedback.classList.remove("is-error");
        await onChanged();
      })();
    });
    sheetForm.append(createTemplateBtn, templateLink, saveSheet);

    const previewHost = el("div", {class: "admin-roster-preview-host"});
    const syncBtn = el(
      "button",
      {type: "button", class: "admin-button"},
      "Sheet から同期（プレビュー）",
    );
    syncBtn.addEventListener("click", () => {
      void (async () => {
        feedback.hidden = true;
        previewHost.replaceChildren();
        const res = await adminFetch<
          {ok: boolean; message?: string; code?: string} & RosterImportPreview
        >(adminRosterSyncPath(roster.rosterId), {
          method: "POST",
          csrfToken: getCsrf(),
          body: JSON.stringify({deactivateMissing: false}),
        });
        if (!res.ok || !res.import) {
          feedback.hidden = false;
          feedback.textContent =
            res.message ||
            (res.code === "CREDENTIAL_MISSING"
              ? "教員 Google 連携が必要です。"
              : res.code === "SHEET_NOT_BOUND"
                ? "スプレッドシート ID を設定してください。"
                : "Sheet 同期プレビューに失敗しました。");
          feedback.classList.add("is-error");
          return;
        }
        renderPreviewBox(previewHost, res, async deactivateMissing => {
          const applyRes = await adminFetch<{
            ok: boolean;
            message?: string;
            rosterRevision?: number;
          }>(adminRosterSyncApplyPath(roster.rosterId), {
            method: "POST",
            csrfToken: getCsrf(),
            body: JSON.stringify({
              importId: res.import.importId,
              previewHash: res.previewHash,
              baseRosterRevision: res.baseRosterRevision,
              deactivateMissing,
            }),
          });
          if (!applyRes.ok) {
            throw new Error(applyRes.message || "Sheet 同期の適用に失敗しました。");
          }
          previewHost.replaceChildren();
          feedback.hidden = false;
          feedback.textContent = "Sheet 同期を適用しました。";
          feedback.classList.remove("is-error");
          await onChanged();
        });
      })();
    });
    sheetForm.append(syncBtn, previewHost);
    card.append(sheetForm);
  }

  const csvSection = el("div", {class: "admin-roster-csv-form"});
  csvSection.append(el("h4", {}, "CSV 取込"));
  const fileInput = el("input", {
    type: "file",
    accept: ".csv,text/csv",
    class: "admin-roster-file",
  }) as HTMLInputElement;
  const csvPreviewHost = el("div", {class: "admin-roster-preview-host"});
  const uploadBtn = el(
    "button",
    {type: "button", class: "admin-button"},
    "CSV をプレビュー",
  );
  uploadBtn.addEventListener("click", () => {
    void (async () => {
      feedback.hidden = true;
      csvPreviewHost.replaceChildren();
      const file = fileInput.files?.[0];
      if (!file) {
        feedback.hidden = false;
        feedback.textContent = "CSV ファイルを選んでください。";
        feedback.classList.add("is-error");
        return;
      }
      const csv = await file.text();
      const res = await adminFetch<
        {ok: boolean; message?: string} & RosterImportPreview
      >(adminRosterImportsPath(roster.rosterId), {
        method: "POST",
        csrfToken: getCsrf(),
        body: JSON.stringify({csv, deactivateMissing: false}),
      });
      if (!res.ok || !res.import) {
        feedback.hidden = false;
        feedback.textContent = res.message || "CSV プレビューに失敗しました。";
        feedback.classList.add("is-error");
        return;
      }
      renderPreviewBox(csvPreviewHost, res, async deactivateMissing => {
        const applyRes = await adminFetch<{ok: boolean; message?: string}>(
          adminRosterImportApplyPath(roster.rosterId, res.import.importId),
          {
            method: "POST",
            csrfToken: getCsrf(),
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
        csvPreviewHost.replaceChildren();
        feedback.hidden = false;
        feedback.textContent = "CSV を適用しました。";
        feedback.classList.remove("is-error");
        await onChanged();
      });
    })();
  });
  csvSection.append(fileInput, uploadBtn, csvPreviewHost);
  card.append(csvSection);

  const studentsSection = el("div", {class: "admin-roster-students"});
  studentsSection.append(el("h4", {}, "登録生徒"));
  const studentsBox = el("div", {class: "admin-roster-students-list"});

  async function refreshStudents(): Promise<void> {
    const res = await adminFetch<{
      ok: boolean;
      students?: ClassroomStudentListItem[];
    }>(adminRosterStudentsPath(rosterId));
    studentsBox.replaceChildren();
    if (!res.ok || !res.students?.length) {
      studentsBox.textContent = res.ok ? "まだ生徒がいません。" : "生徒一覧を取得できませんでした。";
      return;
    }
    const table = el("table", {class: "admin-roster-student-table"});
    const head = el("tr");
    for (const label of ["コード", "氏名", "出席番号", "ログイン名", "グループ", "状態"]) {
      head.append(el("th", {}, label));
    }
    const thead = el("thead");
  thead.append(head);
  table.append(thead);
    const tbody = el("tbody");
    for (const student of res.students) {
      const tr = el("tr");
      tr.append(
        el("td", {}, student.studentCode),
        el("td", {}, student.displayName),
        el("td", {}, student.attendanceNumber ?? ""),
        el("td", {}, student.loginName ?? ""),
        el("td", {}, student.groupLabel ?? ""),
        el("td", {}, student.active ? "在籍" : "無効"),
      );
      tbody.append(tr);
    }
    table.append(tbody);
    studentsBox.append(table);
  }

  studentsSection.append(studentsBox);
  card.append(studentsSection, feedback);
  host.append(card);
  await refreshStudents();
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
  section.append(el("h2", {}, "名簿"));
  host.append(section);

  if (!flags?.classroomRosterEnabled) {
    section.append(
      el(
        "p",
        {class: "admin-muted"},
        "名簿機能はサーバー側で無効です（SYNCRATCH_CLASSROOM_ROSTER_ENABLED=1 が必要）。",
      ),
    );
    return;
  }

  const toolbar = el("div", {class: "admin-roster-toolbar"});
  const createBtn = el(
    "button",
    {type: "button", class: "admin-button primary", "data-testid": "admin-create-roster"},
    "名簿を作る",
  );
  toolbar.append(createBtn);
  section.append(toolbar);

  if (flags) {
    await mountGoogleCredentialPanel(section, flags, getCsrf);
  }

  const listHost = el("div", {class: "admin-roster-list"});
  section.append(listHost);

  async function refreshRosters(): Promise<void> {
    listHost.replaceChildren();
    const rosters = await fetchAdminRosterList();
    if (rosters.length === 0) {
      listHost.textContent = "まだ名簿がありません。";
      return;
    }
    for (const summary of rosters) {
      await mountRosterCard(listHost, summary, flags!, getCsrf, refreshRosters);
    }
  }

  createBtn.addEventListener("click", () => {
    void (async () => {
      const title = window.prompt("名簿の名前", "2026年度 3年A組");
      if (!title) return;
      await adminFetch(ADMIN_ROSTERS_PATH, {
        method: "POST",
        csrfToken: getCsrf(),
        body: JSON.stringify({title}),
      });
      await refreshRosters();
    })();
  });

  await refreshRosters();
}

export function mountPolicyRosterControls(
  card: HTMLElement,
  policy: ClassroomPolicy,
  rosters: ClassroomRosterListItem[],
  flags: AdminClassroomFlags | null,
  getCsrf: () => string,
  onSaved: () => Promise<void>,
): void {
  if (!flags?.classroomRosterEnabled) return;

  const panel = el("div", {
    class: "admin-policy-roster",
    "data-testid": "admin-policy-roster",
  });
  panel.append(el("h3", {}, "名簿と生徒ログイン"));

  const rosterSelect = el("select", {class: "admin-roster-select"}) as HTMLSelectElement;
  const noneOption = el("option", {value: ""}, "名簿なし（匿名リンク）");
  rosterSelect.append(noneOption);
  for (const roster of rosters) {
    const opt = el("option", {value: roster.rosterId}, roster.title);
    if (policy.rosterId === roster.rosterId) {
      opt.selected = true;
    }
    rosterSelect.append(opt);
  }

  const authLabel = el("label", {}, "");
  const authCheck = el("input", {type: "checkbox"}) as HTMLInputElement;
  authCheck.checked = policy.studentAuth.required;
  authLabel.append(
    authCheck,
    document.createTextNode(" 名簿ログイン必須（生徒はログイン/初回登録が必要）"),
  );

  const feedback = el("p", {
    class: "admin-roster-feedback",
    hidden: "true",
  });

  const save = el("button", {type: "button", class: "admin-button"}, "名簿設定を保存");
  save.addEventListener("click", () => {
    void (async () => {
      feedback.hidden = true;
      const rosterId = rosterSelect.value || null;
      const res = await adminFetch<{ok: boolean; message?: string}>(
        `${ADMIN_POLICIES_PATH}/${encodeURIComponent(policy.policyId)}`,
        {
          method: "PATCH",
          csrfToken: getCsrf(),
          body: JSON.stringify({
            rosterId,
            studentAuth: {required: authCheck.checked},
          }),
        },
      );
      if (!res.ok) {
        feedback.hidden = false;
        feedback.textContent = res.message || "名簿設定の保存に失敗しました。";
        feedback.classList.add("is-error");
        return;
      }
      feedback.hidden = false;
      feedback.textContent = "名簿設定を保存しました。";
      feedback.classList.remove("is-error");
      await onSaved();
    })();
  });

  panel.append(
    el("label", {}, "紐づける名簿"),
    rosterSelect,
    authLabel,
    save,
    feedback,
  );
  card.append(panel);
}
