export type ProjectSession = number;

export interface ProjectSessionTracker {
  begin(): ProjectSession;
  isActive(session: ProjectSession): boolean;
  runIfActive(session: ProjectSession, action: () => void): void;
  runSerialized<T>(
    session: ProjectSession,
    action: (isActive: () => boolean) => Promise<T>,
  ): Promise<T | undefined>;
}

export function createProjectSessionTracker(): ProjectSessionTracker {
  let active = 0;
  let operationTail = Promise.resolve();
  return {
    begin() {
      active += 1;
      return active;
    },
    isActive(session) {
      return session === active;
    },
    runIfActive(session, action) {
      if (session === active) action();
    },
    runSerialized(session, action) {
      const run = operationTail.then(() => {
        if (session !== active) return undefined;
        return action(() => session === active);
      });
      operationTail = run.then(
        () => undefined,
        () => undefined,
      );
      return run;
    },
  };
}
