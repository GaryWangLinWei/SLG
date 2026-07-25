import { createRunningIntentStore } from './runningIntentStore';

describe('createRunningIntentStore', () => {
  test('defaults to an inactive session without an owner account', () => {
    const store = createRunningIntentStore();

    expect(store.getSession()).toEqual({ running: false, accountId: null });
  });

  test('atomically stores and clears the running session owner', () => {
    const store = createRunningIntentStore();

    expect(store.setSession({ running: true, accountId: 'account-a' })).toEqual({ running: true, accountId: 'account-a' });
    expect(store.getSession()).toEqual({ running: true, accountId: 'account-a' });
    expect(store.setSession({ running: false, accountId: null })).toEqual({ running: false, accountId: null });
  });

  test('rejects a running session without an owner without changing state', () => {
    const store = createRunningIntentStore();
    store.setSession({ running: true, accountId: 'account-a' });

    expect(() => store.setSession({ running: true, accountId: null })).toThrow(
      'running session accountId must be a non-empty string',
    );
    expect(store.getSession()).toEqual({ running: true, accountId: 'account-a' });
  });

  test('keeps boolean API compatibility while clearing owner on false', () => {
    const store = createRunningIntentStore();

    expect(store.set(true)).toBe(true);
    expect(store.get()).toBe(true);
    expect(store.set(false)).toBe(false);
    expect(store.getSession()).toEqual({ running: false, accountId: null });
  });

  test('rejects non-boolean values without changing the existing value', () => {
    const store = createRunningIntentStore();
    store.set(true);

    expect(() => store.set('false')).toThrow('running intent must be a boolean');
    expect(store.get()).toBe(true);
  });
});
