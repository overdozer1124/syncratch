export class AuthFailedError extends Error {
  readonly code = "AUTH_FAILED" as const;

  constructor(message = "Authentication failed") {
    super(message);
    this.name = "AuthFailedError";
  }
}
