import {STUDENT_SUBMISSIONS_PATH} from "@blocksync/classroom-access";

export interface StudentSubmissionUiOptions {
  root: HTMLElement;
  exportSb3: () => Promise<Uint8Array>;
  getProjectTitle: () => string;
  maxBytes?: number;
}

const DEFAULT_MAX_BYTES = 5 * 1024 * 1024;

export function mountStudentSubmissionUi(options: StudentSubmissionUiOptions): void {
  const maxBytes = options.maxBytes ?? DEFAULT_MAX_BYTES;
  options.root.replaceChildren();

  const heading = document.createElement("p");
  heading.className = "student-submission-heading";
  heading.textContent = "提出";

  const help = document.createElement("p");
  help.className = "student-submission-help";
  help.textContent =
    "編集中の作品を先生の Google ドライブフォルダへ提出します。提出前に内容を確認してください。";

  const feedback = document.createElement("p");
  feedback.className = "student-submission-feedback";
  feedback.hidden = true;

  const submitButton = document.createElement("button");
  submitButton.type = "button";
  submitButton.className = "student-submission-submit";
  submitButton.textContent = "提出する";

  options.root.append(heading, help, feedback, submitButton);

  const showFeedback = (message: string, isError = false) => {
    feedback.textContent = message;
    feedback.hidden = !message;
    feedback.classList.toggle("is-error", isError);
  };

  submitButton.addEventListener("click", () => {
    void (async () => {
      showFeedback("");
      submitButton.disabled = true;
      try {
        const bytes = await options.exportSb3();
        if (bytes.length > maxBytes) {
          showFeedback(
            `提出ファイルが大きすぎます（${Math.floor(maxBytes / (1024 * 1024))} MiB 以下）。「プロジェクトを保存」で .sb3 を端末に保存してから先生に渡してください。`,
            true,
          );
          return;
        }
        const form = new FormData();
        form.set("projectTitle", options.getProjectTitle());
        form.set("idempotencyKey", crypto.randomUUID());
        form.set(
          "sb3",
          new Blob([bytes as BlobPart], {type: "application/x.scratch.sb3"}),
          "submission.sb3",
        );
        const response = await fetch(STUDENT_SUBMISSIONS_PATH, {
          method: "POST",
          credentials: "same-origin",
          body: form,
        });
        const body = (await response.json()) as {
          ok?: boolean;
          message?: string;
          submission?: {isResubmission?: boolean};
        };
        if (!response.ok || !body.ok) {
          showFeedback(
            typeof body.message === "string"
              ? body.message
              : "提出に失敗しました。もう一度お試しください。",
            true,
          );
          return;
        }
        showFeedback(
          body.submission?.isResubmission
            ? "再提出が完了しました。"
            : "提出が完了しました。",
        );
      } catch {
        showFeedback("通信に失敗しました。もう一度お試しください。", true);
      } finally {
        submitButton.disabled = false;
      }
    })();
  });
}

export function hideStudentSubmissionUi(root: HTMLElement): void {
  root.hidden = true;
  root.replaceChildren();
}

export function showStudentSubmissionUi(root: HTMLElement): void {
  root.hidden = false;
}
