import { CommandData, StatusData } from './messages';

export type RemoteAction =
  | 'start_gem_gather'
  | 'start_rally_join'
  | 'start_cave_explore'
  | 'start_research_tech'
  | 'stop_all_tasks'
  | 'get_status'
  | 'get_logs';

export interface RemoteContext {
  /** 启动任务，返回 success/error */
  startTask(name: string, params?: any): Promise<{ success: boolean; error?: string }>;
  /** 停止所有运行中任务 */
  stopAllTasks(): Promise<{ success: boolean; error?: string }>;
  /** 获取当前状态 */
  getStatus(): StatusData;
}

class CommandHandler {
  private ctx: RemoteContext | null = null;

  setContext(ctx: RemoteContext): void {
    this.ctx = ctx;
  }

  async handle(cmd: CommandData): Promise<{ success: boolean; result?: any; error?: string }> {
    if (!this.ctx) return { success: false, error: '上下文未初始化' };

    switch (cmd.action) {
      case 'start_task': {
        const taskName = cmd.payload?.task;
        if (!taskName) return { success: false, error: '缺少 task 参数' };
        return await this.ctx.startTask(taskName, cmd.payload);
      }
      case 'stop_task':
      case 'stop_all': {
        return await this.ctx.stopAllTasks();
      }
      case 'get_status': {
        return { success: true, result: this.ctx.getStatus() };
      }
      case 'get_logs': {
        return { success: true, result: [] }; // 历史日志走 HTTP API
      }
      default:
        return { success: false, error: `未知指令: ${cmd.action}` };
    }
  }
}

export const commandHandler = new CommandHandler();
