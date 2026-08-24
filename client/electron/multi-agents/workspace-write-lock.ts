type Waiter = { ownerId: string; resolve: (release: () => void) => void };
type LockState = { ownerId: string | null; leases: number; waiters: Waiter[] };

const locks = new Map<string, LockState>();

export function acquireWorkspaceWriteLock(workspacePath: string, ownerId: string): Promise<() => void> {
  const state = locks.get(workspacePath) ?? { ownerId: null, leases: 0, waiters: [] };
  locks.set(workspacePath, state);
  return new Promise((resolve) => {
    if (!state.ownerId || state.ownerId === ownerId) grant(state, ownerId, resolve);
    else state.waiters.push({ ownerId, resolve });
  });
}

function grant(state: LockState, ownerId: string, resolve: (release: () => void) => void): void {
  state.ownerId = ownerId;
  state.leases += 1;
  let released = false;
  resolve(() => {
    if (released) return;
    released = true;
    state.leases -= 1;
    if (state.leases > 0) return;
    state.ownerId = null;
    const next = state.waiters.shift();
    if (next) grant(state, next.ownerId, next.resolve);
  });
}
