export interface StoppableTask {
  id: string;
  accountId: string;
  status: string;
}

export function stopTasksByAccount(
  tasks: StoppableTask[],
  accountId: string,
  stopTask: (taskId: string) => { success: boolean },
): string[] {
  const stopped: string[] = [];
  for (const task of tasks) {
    if (task.accountId !== accountId || (task.status !== 'pending' && task.status !== 'running')) continue;
    if (stopTask(task.id).success) stopped.push(task.id);
  }
  return stopped;
}
