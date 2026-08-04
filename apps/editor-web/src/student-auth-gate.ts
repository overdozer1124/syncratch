import type {StudentPolicyView} from "@blocksync/classroom-access";

export function shouldShowStudentAuthGate(policy: StudentPolicyView): boolean {
  return policy.studentAuth.required;
}

export function showStudentAuthShell(root: HTMLElement): void {
  root.hidden = false;
  root.replaceChildren();
  root.classList.add("student-auth-shell");

  const brand = document.createElement("p");
  brand.className = "admin-brand";
  brand.textContent = "Syncratch";

  const title = document.createElement("h1");
  title.textContent = "ログインが必要です";

  const help = document.createElement("p");
  help.className = "student-auth-shell-help";
  help.textContent =
    "この教室では、名簿に登録された生徒のみエディターを使えます。ログインまたは初回登録（アクティベート）は次の PR で利用できます。";

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
  panel.textContent =
    "生徒認証 API は準備中です。先生から案内されたログイン名または登録コードをお待ちください。";

  root.append(brand, title, help, tabs, panel);
}

export function hideStudentAuthShell(root: HTMLElement): void {
  root.hidden = true;
  root.replaceChildren();
}
