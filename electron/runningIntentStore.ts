export interface RunningIntentStore {
  get(): boolean;
  set(value: unknown): boolean;
}

export function createRunningIntentStore(): RunningIntentStore {
  let runningIntent = false;

  return {
    get: () => runningIntent,
    set: (value: unknown) => {
      if (typeof value !== 'boolean') {
        throw new TypeError('running intent must be a boolean');
      }

      runningIntent = value;
      return runningIntent;
    },
  };
}
