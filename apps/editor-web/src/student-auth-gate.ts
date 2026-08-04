import type {StudentPolicyView} from "@blocksync/classroom-access";
import {mountStudentAuthUi} from "./student-auth-ui.js";

export function shouldShowStudentAuthGate(policy: StudentPolicyView): boolean {
  return policy.studentAuth.required;
}

export function showStudentAuthShell(
  root: HTMLElement,
  options?: {onAuthenticated?: () => void},
): void {
  root.hidden = false;
  if (options?.onAuthenticated) {
    mountStudentAuthUi(root, {onAuthenticated: options.onAuthenticated});
    return;
  }
  mountStudentAuthUi(root, {onAuthenticated: () => {}});
}

export function hideStudentAuthShell(root: HTMLElement): void {
  root.hidden = true;
  root.replaceChildren();
}
