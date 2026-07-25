import { stopTasksByAccount } from './stopTasksByAccount';

describe('stopTasksByAccount', () => {
  test('stops only pending and running tasks for the requested account', () => {
    const stoppedByService: string[] = [];
    const tasks = [
      { id: 'pending', accountId: 'account-a', status: 'pending' },
      { id: 'running', accountId: 'account-a', status: 'running' },
      { id: 'completed', accountId: 'account-a', status: 'completed' },
      { id: 'other', accountId: 'account-b', status: 'pending' },
    ];

    const stopped = stopTasksByAccount(tasks, 'account-a', id => {
      stoppedByService.push(id);
      return { success: true };
    });

    expect(stopped).toEqual(['pending', 'running']);
    expect(stoppedByService).toEqual(['pending', 'running']);
  });

  test('returns only tasks whose stop operation succeeds', () => {
    const tasks = [
      { id: 'first', accountId: 'account-a', status: 'pending' },
      { id: 'second', accountId: 'account-a', status: 'running' },
    ];

    expect(stopTasksByAccount(tasks, 'account-a', id => ({ success: id === 'second' })))
      .toEqual(['second']);
  });
});
