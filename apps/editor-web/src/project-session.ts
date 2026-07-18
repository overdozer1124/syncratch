export type ProjectSession = number;

export interface ProjectSessionTracker {
  begin(): ProjectSession;
  isActive(session: ProjectSession): boolean;
  runIfActive(session: ProjectSession, action: () => void): void;
}

export function createProjectSessionTracker(): ProjectSessionTracker {
  let active = 0;
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
  };
}
