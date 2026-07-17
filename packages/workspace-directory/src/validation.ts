export interface ValidationIssue {
  code: string;
  message: string;
  path?: string;
}

export type ValidationResult<T> =
  | {ok: true; value: T}
  | {ok: false; issues: readonly ValidationIssue[]};

export function issue(
  code: string,
  message: string,
  path?: string,
): ValidationIssue {
  return path === undefined ? {code, message} : {code, message, path};
}

export function ok<T>(value: T): ValidationResult<T> {
  return {ok: true, value};
}

export function fail(
  issues: readonly ValidationIssue[],
): ValidationResult<never> {
  return {ok: false, issues};
}
