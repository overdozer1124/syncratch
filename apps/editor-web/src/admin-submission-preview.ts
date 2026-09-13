import {
  ADMIN_ME_PATH,
  adminSubmissionContentPath,
  adminSubmissionPath,
  type SubmissionDetail,
} from "@blocksync/classroom-access";

export type AdminSubmissionPreviewResult =
  | {ok: true; detail: SubmissionDetail; bytes: Uint8Array}
  | {ok: false; message: string};

export async function fetchAdminSubmissionPreviewData(
  submissionId: string,
): Promise<AdminSubmissionPreviewResult> {
  const me = await fetch(ADMIN_ME_PATH, {
    credentials: "same-origin",
    headers: {accept: "application/json"},
  });
  if (!me.ok) {
    return {ok: false, message: "管理者ログインが必要です。"};
  }

  const detailRes = await fetch(adminSubmissionPath(submissionId), {
    credentials: "same-origin",
    headers: {accept: "application/json"},
  });
  if (!detailRes.ok) {
    return {ok: false, message: "提出が見つかりません。"};
  }
  const detailBody = (await detailRes.json()) as {
    ok?: boolean;
    submission?: SubmissionDetail;
  };
  if (!detailBody.ok || !detailBody.submission) {
    return {ok: false, message: "提出が見つかりません。"};
  }

  const contentRes = await fetch(adminSubmissionContentPath(submissionId), {
    credentials: "same-origin",
  });
  if (!contentRes.ok) {
    let message = "SB3 を Drive から取得できませんでした。";
    try {
      const body = (await contentRes.json()) as {message?: string; code?: string};
      if (body.message) message = body.message;
      else if (body.code === "FILE_INACCESSIBLE") {
        message =
          "Drive 上のファイルにアクセスできません。教員 Google 連携と提出フォルダを確認してください。";
      }
    } catch {
      // ignore
    }
    return {ok: false, message};
  }

  return {
    ok: true,
    detail: detailBody.submission,
    bytes: new Uint8Array(await contentRes.arrayBuffer()),
  };
}

export function mountAdminSubmissionPreviewBanner(
  root: HTMLElement,
  detail: SubmissionDetail,
): void {
  root.replaceChildren();
  const banner = document.createElement("div");
  banner.className = "admin-submission-preview-banner";
  banner.setAttribute("data-testid", "admin-submission-preview-banner");
  banner.append(
      document.createTextNode("提出プレビュー（読み取り専用） — "),
      document.createTextNode(
        `${detail.displayName}（${detail.studentCode}） / ${detail.projectTitle} / ${detail.submittedAt}`,
      ),
    );
  root.append(banner);
}

export function applyAdminSubmissionPreviewReadOnlyChrome(): void {
  document.body.classList.add("admin-submission-preview-mode");
  const hideSelectors = [
    '[data-testid="drive-panel"]',
    '[data-testid="collab-panel"]',
    '[data-testid="file-panel"]',
    "#student-submission-panel",
    ".toolbar .primary-controls button",
    "#project-title",
  ];
  for (const selector of hideSelectors) {
    for (const node of document.querySelectorAll<HTMLElement>(selector)) {
      node.hidden = true;
    }
  }
  const titleInput = document.querySelector<HTMLInputElement>("#project-title");
  if (titleInput) titleInput.readOnly = true;
}
