import {
  STUDENT_AUTH_ACTIVATE_PATH,
  STUDENT_AUTH_GOOGLE_RETURN_FLAG,
  STUDENT_AUTH_GOOGLE_RETURN_REASON,
  STUDENT_AUTH_GOOGLE_START_PATH,
  STUDENT_AUTH_LOGIN_PATH,
  STUDENT_AUTH_SESSION_PATH,
  studentAuthMethodIncludesGoogle,
  studentAuthMethodIncludesLocal,
  type StudentAuthMethod,
} from "@blocksync/classroom-access";

export interface StudentAuthSessionView {
  authenticated: true;
  studentId: string;
  displayName: string;
  loginName: string;
}

export async function fetchStudentIdentitySession(): Promise<StudentAuthSessionView | null> {
  try {
    const response = await fetch(STUDENT_AUTH_SESSION_PATH, {
      credentials: "same-origin",
      headers: {accept: "application/json"},
    });
    if (!response.ok) return null;
    const body = (await response.json()) as {
      ok?: boolean;
      authenticated?: boolean;
      studentId?: string;
      displayName?: string;
      loginName?: string;
    };
    if (
      !body.ok ||
      !body.authenticated ||
      typeof body.studentId !== "string" ||
      typeof body.displayName !== "string" ||
      typeof body.loginName !== "string"
    ) {
      return null;
    }
    return {
      authenticated: true,
      studentId: body.studentId,
      displayName: body.displayName,
      loginName: body.loginName,
    };
  } catch {
    return null;
  }
}

export async function loginStudentIdentity(input: {
  loginName: string;
  passphrase: string;
}): Promise<{ok: true} | {ok: false; message: string}> {
  try {
    const response = await fetch(STUDENT_AUTH_LOGIN_PATH, {
      method: "POST",
      credentials: "same-origin",
      headers: {
        accept: "application/json",
        "content-type": "application/json",
      },
      body: JSON.stringify(input),
    });
    const body = (await response.json()) as {ok?: boolean; message?: string};
    if (!response.ok || !body.ok) {
      return {
        ok: false,
        message:
          typeof body.message === "string"
            ? body.message
            : "ログイン情報が正しくありません。",
      };
    }
    return {ok: true};
  } catch {
    return {ok: false, message: "通信に失敗しました。もう一度お試しください。"};
  }
}

export async function activateStudentIdentity(input: {
  enrollmentCode: string;
  passphrase: string;
}): Promise<{ok: true} | {ok: false; message: string}> {
  try {
    const response = await fetch(STUDENT_AUTH_ACTIVATE_PATH, {
      method: "POST",
      credentials: "same-origin",
      headers: {
        accept: "application/json",
        "content-type": "application/json",
      },
      body: JSON.stringify(input),
    });
    const body = (await response.json()) as {ok?: boolean; message?: string};
    if (!response.ok || !body.ok) {
      return {
        ok: false,
        message:
          typeof body.message === "string"
            ? body.message
            : "登録情報が正しくありません。",
      };
    }
    return {ok: true};
  } catch {
    return {ok: false, message: "通信に失敗しました。もう一度お試しください。"};
  }
}

export function buildStudentGoogleOAuthStartUrl(returnTo: string): string {
  if (typeof window === "undefined") {
    const query = new URLSearchParams({return: returnTo});
    return `${STUDENT_AUTH_GOOGLE_START_PATH}?${query.toString()}`;
  }
  const url = new URL(STUDENT_AUTH_GOOGLE_START_PATH, window.location.origin);
  url.searchParams.set("return", returnTo);
  return `${url.pathname}${url.search}`;
}

export function consumeStudentGoogleOAuthReturn(): {
  ok: boolean;
  reason?: string;
} | null {
  if (typeof window === "undefined") return null;
  const params = new URLSearchParams(window.location.search);
  const flag = params.get(STUDENT_AUTH_GOOGLE_RETURN_FLAG);
  if (!flag) return null;
  const reason = params.get(STUDENT_AUTH_GOOGLE_RETURN_REASON) ?? undefined;
  params.delete(STUDENT_AUTH_GOOGLE_RETURN_FLAG);
  params.delete(STUDENT_AUTH_GOOGLE_RETURN_REASON);
  const cleaned = params.toString();
  const nextUrl =
    window.location.pathname + (cleaned ? `?${cleaned}` : "") + window.location.hash;
  window.history.replaceState(null, "", nextUrl);
  return {ok: flag === "ok", reason};
}

export interface MountStudentAuthUiOptions {
  onAuthenticated: () => void;
  authMethod?: StudentAuthMethod;
}

export function mountStudentAuthUi(
  root: HTMLElement,
  options: MountStudentAuthUiOptions,
): void {
  root.replaceChildren();
  root.classList.add("student-auth-shell");

  const authMethod = options.authMethod ?? "google-or-local";
  const showGoogle = studentAuthMethodIncludesGoogle(authMethod);
  const showLocal = studentAuthMethodIncludesLocal(authMethod);

  const brand = document.createElement("p");
  brand.className = "admin-brand";
  brand.textContent = "Syncratch";

  const title = document.createElement("h1");
  title.textContent = "ログインが必要です";

  const help = document.createElement("p");
  help.className = "student-auth-shell-help";
  help.textContent = showGoogle
    ? "この教室では、名簿に登録された生徒のみエディターを使えます。Google アカウントでログインするか、先生から案内された方法でログインしてください。"
    : "この教室では、名簿に登録された生徒のみエディターを使えます。ログインするか、先生から案内された登録コードで初回登録してください。";

  const feedback = document.createElement("p");
  feedback.className = "student-auth-shell-feedback";
  feedback.hidden = true;

  const showFeedback = (message: string) => {
    feedback.textContent = message;
    feedback.hidden = !message;
  };

  const oauthReturn = consumeStudentGoogleOAuthReturn();
  if (oauthReturn?.ok) {
    void fetchStudentIdentitySession().then(session => {
      if (session) options.onAuthenticated();
      else showFeedback("Google ログインに失敗しました。もう一度お試しください。");
    });
  } else if (oauthReturn && !oauthReturn.ok) {
    showFeedback("Google ログインに失敗しました。もう一度お試しください。");
  }

  root.append(brand, title, help, feedback);

  if (showGoogle) {
    const googleSection = document.createElement("div");
    googleSection.className = "student-auth-google-section";

    const googleButton = document.createElement("button");
    googleButton.type = "button";
    googleButton.className = "student-auth-google-button";
    googleButton.textContent = "Google でログイン";
    googleButton.addEventListener("click", () => {
      const returnTo =
        window.location.pathname + window.location.search + window.location.hash;
      window.location.assign(buildStudentGoogleOAuthStartUrl(returnTo));
    });

    googleSection.append(googleButton);
    root.append(googleSection);
  }

  if (!showLocal) {
    return;
  }

  if (showGoogle) {
    const divider = document.createElement("p");
    divider.className = "student-auth-shell-divider";
    divider.textContent = "または";
    root.append(divider);
  }

  const tabs = document.createElement("div");
  tabs.className = "student-auth-shell-tabs";
  tabs.setAttribute("role", "tablist");
  tabs.setAttribute("aria-label", "生徒認証");

  const loginTab = document.createElement("button");
  loginTab.type = "button";
  loginTab.className = "student-auth-shell-tab is-active";
  loginTab.setAttribute("role", "tab");
  loginTab.setAttribute("aria-selected", "true");
  loginTab.textContent = "ログイン";

  const activateTab = document.createElement("button");
  activateTab.type = "button";
  activateTab.className = "student-auth-shell-tab";
  activateTab.setAttribute("role", "tab");
  activateTab.setAttribute("aria-selected", "false");
  activateTab.textContent = "初回登録";

  tabs.append(loginTab, activateTab);

  const panel = document.createElement("div");
  panel.className = "student-auth-shell-panel";
  panel.setAttribute("role", "tabpanel");

  const loginForm = document.createElement("form");
  loginForm.className = "student-auth-form";
  loginForm.innerHTML = `
    <label>
      <span>ログイン名</span>
      <input name="loginName" autocomplete="username" required />
    </label>
    <label>
      <span>パスフレーズ</span>
      <input name="passphrase" type="password" autocomplete="current-password" required />
    </label>
    <button type="submit">ログイン</button>
  `;

  const activateForm = document.createElement("form");
  activateForm.className = "student-auth-form";
  activateForm.hidden = true;
  activateForm.innerHTML = `
    <label>
      <span>登録コード</span>
      <input name="enrollmentCode" autocomplete="one-time-code" required />
    </label>
    <label>
      <span>パスフレーズ（8文字以上）</span>
      <input name="passphrase" type="password" autocomplete="new-password" required minlength="8" />
    </label>
    <button type="submit">登録してログイン</button>
  `;

  panel.append(loginForm, activateForm);
  root.append(tabs, panel);

  const selectTab = (mode: "login" | "activate") => {
    const loginActive = mode === "login";
    loginTab.classList.toggle("is-active", loginActive);
    activateTab.classList.toggle("is-active", !loginActive);
    loginTab.setAttribute("aria-selected", loginActive ? "true" : "false");
    activateTab.setAttribute("aria-selected", loginActive ? "false" : "true");
    loginForm.hidden = !loginActive;
    activateForm.hidden = loginActive;
    showFeedback("");
  };

  loginTab.addEventListener("click", () => selectTab("login"));
  activateTab.addEventListener("click", () => selectTab("activate"));

  loginForm.addEventListener("submit", event => {
    event.preventDefault();
    void (async () => {
      showFeedback("");
      const data = new FormData(loginForm);
      const result = await loginStudentIdentity({
        loginName: String(data.get("loginName") ?? ""),
        passphrase: String(data.get("passphrase") ?? ""),
      });
      if (!result.ok) {
        showFeedback(result.message);
        return;
      }
      options.onAuthenticated();
    })();
  });

  activateForm.addEventListener("submit", event => {
    event.preventDefault();
    void (async () => {
      showFeedback("");
      const data = new FormData(activateForm);
      const result = await activateStudentIdentity({
        enrollmentCode: String(data.get("enrollmentCode") ?? ""),
        passphrase: String(data.get("passphrase") ?? ""),
      });
      if (!result.ok) {
        showFeedback(result.message);
        return;
      }
      options.onAuthenticated();
    })();
  });
}
