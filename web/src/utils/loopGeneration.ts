export function isCurrentLoopGeneration(generation: number, currentGeneration: number): boolean {
  return generation === currentGeneration;
}

export function createLoopCancellationPredicate(
  generation: number,
  getCurrentGeneration: () => number,
  getStopped: () => boolean,
): () => boolean {
  return () => getStopped() || generation !== getCurrentGeneration();
}

export async function guardedCreateTask<T extends { success: boolean; task?: { id: string } }>(
  create: () => Promise<T>,
  stop: (taskId: string) => Promise<unknown>,
  isStopped: () => boolean,
): Promise<T> {
  if (isStopped()) throw new Error('loop generation cancelled');
  const result = await create();
  if (isStopped()) {
    if (result.success && result.task?.id) {
      await stop(result.task.id).catch(() => {});
    }
    throw new Error('loop generation cancelled');
  }
  return result;
}
