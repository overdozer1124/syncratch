/**
 * E2E-only counters for side effects that must not run during load suppress.
 */

let persistAttempts = 0;
let collabOutboundAttempts = 0;

export function recordE2ePersistAttempt(): void {
  persistAttempts += 1;
}

export function recordE2eCollabOutbound(): void {
  collabOutboundAttempts += 1;
}

export function getE2eSideEffectCounters(): {
  persistAttempts: number;
  collabOutboundAttempts: number;
} {
  return {persistAttempts, collabOutboundAttempts};
}

export function resetE2eSideEffectCounters(): void {
  persistAttempts = 0;
  collabOutboundAttempts = 0;
}
