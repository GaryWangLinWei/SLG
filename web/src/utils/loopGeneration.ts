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
