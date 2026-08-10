import {
  ADMIN_GOOGLE_OAUTH_PICKER_TOKEN_PATH,
  ADMIN_GOOGLE_OAUTH_SESSION_PATH,
  ADMIN_POLICIES_PATH,
  adminPolicySubmissionsPath,
  adminSubmissionContentPath,
  adminSubmissionPath,
  adminSubmissionPreviewSurfacePath,
  type ClassroomPolicy,
  type SubmissionDetail,
  type SubmissionListItem,
} from "@blocksync/classroom-access";
import {
  fetchAdminClassroomFlags,
  type AdminClassroomFlags,
} from "./admin-classroom-flags.js";
import {
  adminFetch,
  createBadge,
  createSegmentControl,
  el,
  emptyValue,
  formatShortTimestamp,
  type AdminSaveFooterController,
} from "./admin-console-shared.js";
import {pickTeacherDriveFolder} from "./admin-google-picker.js";

export type {AdminClassroomFlags};
export {fetchAdminClassroomFlags};

function truncateFolderId(folderId: string | null): string {
  if (!folderId) return "未設定";
  if (folderId.length <= 16) return folderId;
  return `${folderId.slice(0, 8)}…${folderId.slice(-6)}`;
}

export function mountPolicySubmissionSettings(
  policy: ClassroomPolicy,
  flags: AdminClassroomFlags | null,
  getCsrf: () => string,
  saveFooter: AdminSaveFooterController,
  onSaved: () => Promise<void>,
  pickFolder: (accessToken: string) => Promise<string | null> = pickTeacherDriveFolder,
): HTMLElement {
  const panel = el("div", {
    class: "admin2-card admin-submission-settings",
    "data-testid": "admin-submission-settings",
  });
  panel.append(
    el("div", {class: "admin2-card-header"}, undefined),
  );
  panel.querySelector(".admin2-card-header")!.append(
    el("h4", {class: "admin2-card-title"}, "提出設定"),
  );

  const body = el("div", {class: "admin2-card-body"});
  const feedback = el("p", {
    class: "admin2-feedback admin-submission-settings-feedback",
    hidden: "true",
  });
  panel.append(body, feedback);

  if (!flags?.teacherDriveSubmissionEnabled) {
    body.append(
      el(
        "p",
        {class: "admin2-feedback"},
        "提出機能はサーバー側で無効です（TEACHER_DRIVE_SUBMISSION）。",
      ),
    );
    return panel;
  }

  const enabledRow = el("div", {class: "admin2-row admin2-row-label-policy"});
  enabledRow.append(el("span", {class: "admin2-row-label"}, "提出"));
  const enabledValue = el("div", {class: "admin2-row-value"});
  enabledRow.append(enabledValue);

  const folderRow = el("div", {class: "admin2-row admin2-row-label-policy"});
  folderRow.append(el("span", {class: "admin2-row-label"}, "Drive フォルダ"));
  const folderValue = el("div", {class: "admin2-row-value admin-submission-folder-value"});
  const pickFolderBtn = el(
    "button",
    {type: "button", class: "admin2-btn admin2-btn-secondary admin2-btn-sm"},
    "Drive フォルダを選ぶ",
  );
  folderRow.append(folderValue, pickFolderBtn);
  body.append(
    enabledRow,
    folderRow,
    el(
      "p",
      {style: "font-size:11px;color:#5b708a;margin:6px 0 0"},
      "生徒の SB3 は教員 Google 連携で選んだフォルダに保存されます。提出 ON にはフォルダ指定が必要です。",
    ),
  );

  let submissionEnabled = policy.submission.enabled;
  let folderId = policy.submissionDriveFolderId;

  function showFeedback(message: string, isError = false): void {
    feedback.hidden = false;
    feedback.textContent = message;
    feedback.className = `admin2-feedback admin-submission-settings-feedback${
      isError ? " is-error" : ""
    }`;
  }

  function hideFeedback(): void {
    feedback.hidden = true;
    feedback.textContent = "";
    feedback.className = "admin2-feedback admin-submission-settings-feedback";
  }

  function renderFolderLabel(): void {
    folderValue.replaceChildren(
      el("span", {class: "is-mono"}, truncateFolderId(folderId)),
    );
  }

  function renderEnabledSegment(): void {
    enabledValue.replaceChildren(
      createSegmentControl(
        [
          {label: "OFF", value: "off"},
          {label: "ON", value: "on"},
        ],
        submissionEnabled ? "on" : "off",
        value => {
          if (value === "on" && !folderId) {
            showFeedback("提出を ON にする前に Drive フォルダを選んでください。", true);
            renderEnabledSegment();
            return;
          }
          submissionEnabled = value === "on";
          renderEnabledSegment();
          void saveSubmissionSettings();
        },
      ),
      el(
        "span",
        {style: "font-size:11px;color:#5b708a"},
        submissionEnabled
          ? "名簿ログインが必須のクラスで生徒が SB3 を提出できます。"
          : "提出は無効です。",
      ),
    );
  }

  async function ensureGoogleConnected(): Promise<boolean> {
    const session = await adminFetch<{
      ok: boolean;
      connected?: boolean;
      googleEmail?: string;
    }>(ADMIN_GOOGLE_OAUTH_SESSION_PATH);
    if (!session.ok || !session.connected) {
      showFeedback(
        "教員 Google 連携が必要です。アカウント画面から Google を接続してください。",
        true,
      );
      return false;
    }
    return true;
  }

  async function saveSubmissionSettings(
    nextFolderId = folderId,
  ): Promise<void> {
    hideFeedback();
    const prevEnabled = policy.submission.enabled;
    const prevFolderId = policy.submissionDriveFolderId;
    const res = await adminFetch<{ok: boolean; message?: string; code?: string}>(
      `${ADMIN_POLICIES_PATH}/${encodeURIComponent(policy.policyId)}`,
      {
        method: "PATCH",
        csrfToken: getCsrf(),
        body: JSON.stringify({
          submission: {enabled: submissionEnabled},
          submissionDriveFolderId: nextFolderId,
        }),
      },
    );
    if (!res.ok) {
      submissionEnabled = prevEnabled;
      folderId = prevFolderId;
      renderEnabledSegment();
      renderFolderLabel();
      const message =
        res.code === "SUBMISSION_REQUIRES_FOLDER"
          ? "提出 ON には Drive フォルダの指定が必要です。"
          : res.message || "提出設定の保存に失敗しました。";
      saveFooter.setError(message);
      showFeedback(message, true);
      return;
    }
    saveFooter.pushUndo(async () => {
      await adminFetch(`${ADMIN_POLICIES_PATH}/${encodeURIComponent(policy.policyId)}`, {
        method: "PATCH",
        csrfToken: getCsrf(),
        body: JSON.stringify({
          submission: {enabled: prevEnabled},
          submissionDriveFolderId: prevFolderId,
        }),
      });
      await onSaved();
    });
    policy.submission.enabled = submissionEnabled;
    policy.submissionDriveFolderId = nextFolderId;
    folderId = nextFolderId;
    renderFolderLabel();
    saveFooter.setSaved();
    await onSaved();
  }

  pickFolderBtn.addEventListener("click", () => {
    void (async () => {
      hideFeedback();
      if (!(await ensureGoogleConnected())) return;
      const tokenRes = await adminFetch<{
        ok: boolean;
        accessToken?: string;
        code?: string;
        message?: string;
      }>(ADMIN_GOOGLE_OAUTH_PICKER_TOKEN_PATH);
      if (!tokenRes.ok || !tokenRes.accessToken) {
        const message =
          tokenRes.code === "CREDENTIAL_MISSING"
            ? "教員 Google 連携が切れています。再接続してください。"
            : tokenRes.message || "Drive Picker 用トークンを取得できませんでした。";
        showFeedback(message, true);
        return;
      }
      let picked: string | null;
      try {
        picked = await pickFolder(tokenRes.accessToken);
      } catch (error) {
        showFeedback(
          error instanceof Error ? error.message : "Drive フォルダの選択に失敗しました。",
          true,
        );
        return;
      }
      if (!picked) return;
      folderId = picked;
      renderFolderLabel();
      await saveSubmissionSettings(picked);
    })();
  });

  renderEnabledSegment();
  renderFolderLabel();
  return panel;
}

function formatBytes(sizeBytes: number): string {
  if (sizeBytes < 1024) return `${sizeBytes} B`;
  if (sizeBytes < 1024 * 1024) return `${Math.round(sizeBytes / 1024)} KiB`;
  return `${(sizeBytes / (1024 * 1024)).toFixed(1)} MiB`;
}

async function downloadSubmissionContent(submissionId: string, fileName: string): Promise<void> {
  const response = await fetch(adminSubmissionContentPath(submissionId), {
    credentials: "same-origin",
  });
  if (!response.ok) {
    let message = "SB3 を取得できませんでした。";
    try {
      const body = (await response.json()) as {message?: string; code?: string};
      if (body.message) message = body.message;
      else if (body.code === "FILE_INACCESSIBLE") {
        message =
          "Drive 上のファイルにアクセスできません。フォルダを選び直すか、教員 Google 連携を確認してください。";
      }
    } catch {
      // binary error body
    }
    throw new Error(message);
  }
  const bytes = new Uint8Array(await response.arrayBuffer());
  const blob = new Blob([bytes as BlobPart], {type: "application/x.scratch.sb3"});
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = fileName.endsWith(".sb3") ? fileName : `${fileName}.sb3`;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

function renderSubmissionDetail(
  container: HTMLElement,
  detail: SubmissionDetail,
  previewEnabled: boolean,
): void {
  container.replaceChildren();
  container.append(
    el("h4", {class: "admin2-card-title"}, "提出詳細"),
    el(
      "p",
      {class: "admin2-feedback"},
      `${detail.displayName}（${detail.studentCode}） / ${detail.projectTitle}`,
    ),
    el(
      "p",
      {class: "admin2-feedback"},
      `提出: ${formatShortTimestamp(detail.submittedAt)} / ${formatBytes(detail.sizeBytes)}${
        detail.isResubmission ? " / 再提出" : ""
      }`,
    ),
  );

  const actions = el("div", {class: "admin-submission-actions"});
  const download = el(
    "button",
    {type: "button", class: "admin2-btn admin2-btn-sm"},
    "SB3 をダウンロード",
  );
  download.addEventListener("click", () => {
    void downloadSubmissionContent(
      detail.submissionId,
      detail.projectTitle || "submission",
    ).catch(error => {
      container.append(
        el(
          "p",
          {class: "admin2-feedback is-error"},
          error instanceof Error ? error.message : "ダウンロードに失敗しました。",
        ),
      );
    });
  });
  actions.append(download);

  if (previewEnabled) {
    const preview = el(
      "a",
      {
        class: "admin2-btn admin2-btn-primary admin2-btn-sm",
        href: adminSubmissionPreviewSurfacePath(detail.submissionId),
        target: "_blank",
        rel: "noopener noreferrer",
      },
      "プレビューを開く",
    );
    actions.append(preview);
  }

  container.append(actions);
}

export async function mountPolicySubmissionsPanel(
  host: HTMLElement,
  policy: ClassroomPolicy,
  flags: AdminClassroomFlags | null,
  rosterStudentCount?: number,
): Promise<void> {
  if (!policy.submission.enabled) return;

  const panel = el("div", {
    class: "admin2-card admin-submissions-panel",
    "data-testid": "admin-submissions-panel",
  });
  const header = el("div", {class: "admin2-card-header"});
  header.append(el("h4", {class: "admin2-card-title"}, "提出"));
  const countHint = el("span", {class: "admin2-card-hint"}, "なし");
  header.append(countHint);
  const exportBtn = el(
    "button",
    {type: "button", class: "admin2-btn admin2-btn-sm", style: "margin-left:auto"},
    "CSV で書き出す",
  );
  header.append(exportBtn);

  const feedback = el("p", {
    class: "admin2-feedback admin-submission-feedback",
    hidden: "true",
  });
  const detailBox = el("div", {class: "admin-submission-detail"});
  panel.append(header, feedback, detailBox);
  host.append(panel);

  if (!flags?.teacherDriveSubmissionEnabled) {
    feedback.hidden = false;
    feedback.textContent = "提出機能はサーバー側で無効です（TEACHER_DRIVE_SUBMISSION）。";
    return;
  }

  let submissions: SubmissionListItem[] = [];
  try {
    const response = await fetch(adminPolicySubmissionsPath(policy.policyId), {
      credentials: "same-origin",
      headers: {accept: "application/json"},
    });
    if (response.status === 404) {
      feedback.hidden = false;
      feedback.textContent = "提出 API は利用できません。";
      return;
    }
    if (!response.ok) {
      feedback.hidden = false;
      feedback.textContent = "提出一覧を取得できませんでした。";
      return;
    }
    const body = (await response.json()) as {
      ok?: boolean;
      submissions?: SubmissionListItem[];
    };
    submissions = body.submissions ?? [];
  } catch {
    feedback.hidden = false;
    feedback.textContent = "提出一覧の取得に失敗しました。";
    return;
  }

  const submittedCount = submissions.length;
  const totalCount = rosterStudentCount ?? submittedCount;
  countHint.textContent = `${submittedCount} / ${totalCount} 名`;

  const tableHost = el("div", {class: "admin2-card-body is-flush"});
  panel.insertBefore(tableHost, detailBox);

  const table = el("table", {class: "admin2-table admin-submission-table"});
  const headRow = el("tr");
  for (const label of ["出席番号", "氏名", "提出", "日時"]) {
    headRow.append(el("th", {}, label));
  }
  table.append(el("thead"), el("tbody"));
  table.querySelector("thead")!.append(headRow);
  const tbody = table.querySelector("tbody")!;

  if (submissions.length === 0) {
    const tr = el("tr");
    tr.append(
      el("td", {class: "is-empty", colspan: "4"}, "なし"),
    );
    tbody.append(tr);
  } else {
    for (const row of submissions) {
      const tr = el("tr", {class: "is-clickable"});
      tr.append(
        el("td", {class: "is-mono"}, row.attendanceNumber ?? "なし"),
        el("td", {}, row.displayName),
        el("td", {}, createBadge("提出済", "success")),
        el(
          "td",
          {class: "is-mono"},
          formatShortTimestamp(row.submittedAt),
        ),
      );
      tr.addEventListener("click", () => {
        void (async () => {
          feedback.hidden = true;
          feedback.textContent = "";
          const detailRes = await fetch(adminSubmissionPath(row.submissionId), {
            credentials: "same-origin",
            headers: {accept: "application/json"},
          });
          if (!detailRes.ok) {
            feedback.hidden = false;
            feedback.textContent = "提出詳細を取得できませんでした。";
            return;
          }
          const detailBody = (await detailRes.json()) as {
            ok?: boolean;
            submission?: SubmissionDetail;
          };
          if (!detailBody.ok || !detailBody.submission) {
            feedback.hidden = false;
            feedback.textContent = "提出詳細を取得できませんでした。";
            return;
          }
          renderSubmissionDetail(
            detailBox,
            detailBody.submission,
            Boolean(flags?.submissionPreviewEnabled),
          );
        })();
      });
      tbody.append(tr);
    }
  }

  tableHost.append(table);

  exportBtn.addEventListener("click", () => {
    if (submissions.length === 0) return;
    const lines = [
      "attendance_number,display_name,submitted_at,project_title",
      ...submissions.map(s =>
        [
          s.attendanceNumber ?? "",
          s.displayName,
          s.submittedAt,
          s.projectTitle,
        ]
          .map(v => `"${String(v).replace(/"/g, '""')}"`)
          .join(","),
      ),
    ];
    const blob = new Blob([lines.join("\n")], {type: "text/csv;charset=utf-8"});
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `${policy.title}-submissions.csv`;
    anchor.click();
    URL.revokeObjectURL(url);
  });
}
