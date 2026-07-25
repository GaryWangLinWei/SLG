import { createRunningIntentStore } from './runningIntentStore';

describe('createRunningIntentStore', () => {
  test('defaults to false', () => {
    const store = createRunningIntentStore();

    expect(store.get()).toBe(false);
  });

  test('stores true and false during the same lifecycle', () => {
    const store = createRunningIntentStore();

    expect(store.set(true)).toBe(true);
    expect(store.get()).toBe(true);
    expect(store.set(false)).toBe(false);
    expect(store.get()).toBe(false);
  });

  test('rejects non-boolean values without changing the existing value', () => {
    const store = createRunningIntentStore();
    store.set(true);

    let thrown: unknown;
    try {
      store.set('false');
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(TypeError);
    expect((thrown as TypeError).message).toBe(
      'running intent must be a boolean',
    );
    expect(store.get()).toBe(true);
  });
});
