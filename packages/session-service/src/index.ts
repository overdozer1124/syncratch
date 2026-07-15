/**
 * @experimental R1 session-service — login + AuthRepository port.
 */

export type {
  AuthRepository,
  AuthRepositoryTx,
  SessionRow,
} from "./ports.js";
export { AuthFailedError } from "./errors.js";
export {
  createSessionService,
  type CreateSessionServiceDeps,
  type LoginSuccess,
  type SessionService,
} from "./session-service.js";
export { createMemoryAuthRepository } from "./memory-auth-repository.js";
