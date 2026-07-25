export interface ExclusiveOperation {
  isLocked(): boolean;
  run(): Promise<boolean>;
}

export function createExclusiveOperation(
  operation: () => Promise<void>,
): ExclusiveOperation {
  let locked = false;

  return {
    isLocked: () => locked,
    async run(): Promise<boolean> {
      if (locked) {
        return false;
      }

      locked = true;
      try {
        await operation();
        return true;
      } finally {
        locked = false;
      }
    },
  };
}
