export interface RunningSession {
  running: boolean;
  accountId: string | null;
}

export interface RunningIntentStore {
  get(): boolean;
  set(value: unknown): boolean;
  getSession(): RunningSession;
  setSession(value: unknown): RunningSession;
}

function validateSession(value: unknown): RunningSession {
  if (!value || typeof value !== 'object') {
    throw new TypeError('running session must be an object');
  }
  const { running, accountId } = value as Partial<RunningSession>;
  if (typeof running !== 'boolean') {
    throw new TypeError('running session running must be a boolean');
  }
  if (running && (typeof accountId !== 'string' || accountId.trim() === '')) {
    throw new TypeError('running session accountId must be a non-empty string');
  }
  if (!running && accountId !== null) {
    throw new TypeError('stopped session accountId must be null');
  }
  return { running, accountId: running ? accountId!.trim() : null };
}

export function createRunningIntentStore(): RunningIntentStore {
  let session: RunningSession = { running: false, accountId: null };

  return {
    get: () => session.running,
    set: (value: unknown) => {
      if (typeof value !== 'boolean') {
        throw new TypeError('running intent must be a boolean');
      }
      session = { running: value, accountId: value ? session.accountId : null };
      return session.running;
    },
    getSession: () => ({ ...session }),
    setSession: (value: unknown) => {
      session = validateSession(value);
      return { ...session };
    },
  };
}
