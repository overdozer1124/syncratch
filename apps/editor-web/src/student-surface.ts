import {
  studentPolicyByTokenPath,
  type StudentPolicyView,
} from "@blocksync/classroom-access";

export async function fetchStudentPolicy(
  token: string,
): Promise<StudentPolicyView | null> {
  try {
    const response = await fetch(studentPolicyByTokenPath(token), {
      credentials: "same-origin",
      headers: {accept: "application/json"},
    });
    if (!response.ok) return null;
    const body = (await response.json()) as {
      ok?: boolean;
      policy?: StudentPolicyView;
    };
    if (!body.ok || !body.policy) return null;
    return body.policy;
  } catch {
    return null;
  }
}

export function showStudentLinkError(root: HTMLElement): void {
  root.hidden = false;
  root.replaceChildren();
  root.classList.add("student-error-shell");
  const brand = document.createElement("p");
  brand.className = "admin-brand";
  brand.textContent = "Syncratch";
  const title = document.createElement("h1");
  title.textContent = "このリンクは使えません";
  const help = document.createElement("p");
  help.textContent =
    "リンクが間違っているか、期限切れ・失効している可能性があります。管理者に連絡してください。";
  root.append(brand, title, help);
}
