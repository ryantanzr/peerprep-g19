export interface SessionUser {
  userId: string;
  username: string;
  connectionId: string;
}

export interface SessionState {
  users: Map<string, SessionUser>; // connectionId -> user
  language: string;
  ended: boolean;
}

const VALID_LANGUAGES = ["python3", "java", "cpp", "c"];
const MAX_USERS = 2;

export function createSession(): SessionState {
  return { users: new Map(), language: "python3", ended: false };
}

export function addUser(
  state: SessionState,
  connId: string,
  userId: string,
  username: string,
): { ok: true; replacedConnId?: string } | { ok: false; error: string } {
  if (state.ended) return { ok: false, error: "Session has ended" };

  // If the same userId is already in the session (e.g., browser refresh),
  // replace the stale connection instead of rejecting as "Session full"
  for (const [existingConnId, existingUser] of state.users) {
    if (existingUser.userId === userId) {
      state.users.delete(existingConnId);
      state.users.set(connId, { userId, username, connectionId: connId });
      return { ok: true, replacedConnId: existingConnId };
    }
  }

  if (state.users.size >= MAX_USERS) return { ok: false, error: "Session full" };

  state.users.set(connId, { userId, username, connectionId: connId });
  return { ok: true };
}

export function removeUser(state: SessionState, connId: string): SessionUser | null {
  const user = state.users.get(connId);
  if (user) state.users.delete(connId);
  return user || null;
}

export function endSession(state: SessionState): void {
  state.ended = true;
}

export function changeLanguage(state: SessionState, language: string): boolean {
  if (!VALID_LANGUAGES.includes(language)) return false;
  state.language = language;
  return true;
}

export function getUserCount(state: SessionState): number {
  return state.users.size;
}
