import { taskService } from './TaskService';
import { commandHandler, RemoteContext } from '../../core/remote/CommandHandler';
import { remoteClient } from '../../core/remote/RemoteClient';
import { StatusData } from '../../core/remote/messages';

// 远程指令到本地 action 的映射
const ACTION_MAP: Record<string, { pluginId: string; actionId: string }> = {
  gem_gather: { pluginId: 'com.rok.automation', actionId: 'gem-gather' },
  rally_join: { pluginId: 'com.rok.automation', actionId: 'join-rally' },
  cave_explore: { pluginId: 'com.rok.automation', actionId: 'cave-explore' },
  research_tech: { pluginId: 'com.rok.automation', actionId: 'research-tech' },
  home_loop: { pluginId: 'com.rok.automation', actionId: 'loop-collect' },
};

class RemoteContextService implements RemoteContext {
  private defaultAccountId = '';

  /** 设置远程控制要操作的默认账号（主页第一个账号） */
  setDefaultAccount(accountId: string): void {
    this.defaultAccountId = accountId;
  }

  async startTask(name: string, params?: any): Promise<{ success: boolean; error?: string }> {
    const mapping = ACTION_MAP[name];
    if (!mapping) return { success: false, error: `未知任务: ${name}` };
    if (!this.defaultAccountId) return { success: false, error: '尚未选择账号' };

    try {
      const task = taskService.createTask(this.defaultAccountId, mapping.pluginId, mapping.actionId, params || {});
      // 异步执行，不等结果
      taskService.runTask(task.id).catch(e => console.error('[Remote] task error:', e));
      return { success: true };
    } catch (e: any) {
      return { success: false, error: e.message || String(e) };
    }
  }

  async stopAllTasks(): Promise<{ success: boolean; error?: string }> {
    try {
      const tasks = taskService.listTasks().filter(t => t.status === 'running' || t.status === 'pending');
      for (const t of tasks) taskService.stopTask(t.id);
      return { success: true };
    } catch (e: any) {
      return { success: false, error: e.message || String(e) };
    }
  }

  getStatus(): StatusData {
    const tasks = taskService.listTasks().filter(t => t.status === 'running');
    return {
      online: true,
      runningTasks: tasks.map(t => `${t.pluginId}:${t.actionId}`),
    };
  }
}

export const remoteContextService = new RemoteContextService();

/** 在 server 启动时调用一次：把 CommandHandler 接到 RemoteClient */
export function wireRemoteControl(): void {
  commandHandler.setContext(remoteContextService);
  remoteClient.onCommand(async (cmd) => commandHandler.handle(cmd));
  remoteClient.onStatusRequest(() => remoteContextService.getStatus());
  console.log('[Remote] command handler wired');
}
