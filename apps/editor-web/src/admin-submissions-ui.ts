import {
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
  createBadge,
  el,
  emptyValue,
  formatShortTimestamp,
} from "./admin-console-shared.js";

export type {AdminClassroomFlags};
export {fetchAdminClassroomFlags};

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
