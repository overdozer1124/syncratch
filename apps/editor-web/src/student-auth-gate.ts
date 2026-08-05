import type {StudentPolicyView} from "@blocksync/classroom-access";
import {mountStudentAuthUi} from "./student-auth-ui.js";

export function shouldShowStudentAuthGate(policy: StudentPolicyView): boolean {
  return policy.studentAuth.required;
}

export function showStudentAuthShell(
  root: HTMLElement,
  options?: {onAuthenticated?: () => void; policy?: StudentPolicyView},
): void {
  root.hidden = false;
  const authMethod = options?.policy?.studentAuth.method;
  if (options?.onAuthenticated) {
    mountStudentAuthUi(root, {
      onAuthenticated: options.onAuthenticated,
      authMethod,
    });
    return;
  }
  mountStudentAuthUi(root, {onAuthenticated: () => {}, authMethod});
}

export function hideStudentAuthShell(root: HTMLElement): void {
  root.hidden = true;
  root.replaceChildren();
}
