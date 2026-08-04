import {
  ADMIN_CLASSROOM_FLAGS_PATH,
  adminPolicySubmissionsPath,
  adminSubmissionContentPath,
  adminSubmissionPath,
  adminSubmissionPreviewSurfacePath,
  type ClassroomPolicy,
  type SubmissionDetail,
  type SubmissionListItem,
} from "@blocksync/classroom-access";

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

export interface AdminClassroomFlags {
  classroomRosterEnabled: boolean;
  teacherDriveSubmissionEnabled: boolean;
  submissionPreviewEnabled: boolean;
}

export async function fetchAdminClassroomFlags(): Promise<AdminClassroomFlags | null> {
  try {
    const response = await fetch(ADMIN_CLASSROOM_FLAGS_PATH, {
      credentials: "same-origin",
      headers: {accept: "application/json"},
    });
    if (!response.ok) return null;
    const body = (await response.json()) as {
      ok?: boolean;
      flags?: AdminClassroomFlags;
    };
    if (!body.ok || !body.flags) return null;
    return body.flags;
  } catch {
    return null;
  }
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
    el("h3", {}, "提出詳細"),
    el(
      "p",
      {class: "admin-muted"},
      `${detail.displayName}（${detail.studentCode}） / ${detail.projectTitle}`,
    ),
    el(
      "p",
      {class: "admin-muted"},
      `提出: ${detail.submittedAt} / ${formatBytes(detail.sizeBytes)}${
        detail.isResubmission ? " / 再提出" : ""
      }`,
    ),
  );

  const actions = el("div", {class: "admin-submission-actions"});
  const download = el(
    "button",
    {type: "button", class: "admin-button"},
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
          {class: "admin-submission-feedback is-error"},
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
        class: "admin-button primary",
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
  card: HTMLElement,
  policy: ClassroomPolicy,
  flags: AdminClassroomFlags | null,
): Promise<void> {
  if (!policy.submission.enabled) return;

  const panel = el("section", {
    class: "admin-submissions-panel",
    "data-testid": "admin-submissions-panel",
  });
  panel.append(el("h3", {}, "提出一覧"));
  const feedback = el("p", {
    class: "admin-submission-feedback",
    hidden: "true",
  });
  const list = el("div", {class: "admin-submission-list"});
  const detailBox = el("div", {class: "admin-submission-detail"});
  panel.append(feedback, list, detailBox);
  card.append(panel);

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

  if (submissions.length === 0) {
    list.textContent = "まだ提出はありません。";
    return;
  }

  const table = el("table", {class: "admin-submission-table"});
  const thead = el("thead");
  const headRow = el("tr");
  for (const label of ["生徒", "作品名", "提出日時", ""]) {
    headRow.append(el("th", {}, label));
  }
  thead.append(headRow);
  table.append(thead);

  const tbody = el("tbody");
  for (const row of submissions) {
    const tr = el("tr");
    tr.append(
      el("td", {}, `${row.displayName} (${row.studentCode})`),
      el("td", {}, row.projectTitle),
      el(
        "td",
        {},
        `${row.submittedAt}${row.isResubmission ? " · 再提出" : ""}`,
      ),
    );
    const actionCell = el("td", {});
    const detailBtn = el(
      "button",
      {type: "button", class: "admin-button"},
      "詳細",
    );
    detailBtn.addEventListener("click", () => {
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
    actionCell.append(detailBtn);
    tr.append(actionCell);
    tbody.append(tr);
  }
  table.append(tbody);
  list.append(table);
}
