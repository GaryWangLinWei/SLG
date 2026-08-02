import { taskService } from './TaskService';
import { accountService } from './AccountService';
import { deviceService } from './DeviceService';
import { commandHandler, RemoteContext } from '../../core/remote/CommandHandler';
import { remoteClient } from '../../core/remote/RemoteClient';
import { StatusData } from '../../core/remote/messages';
import { emit as emitRemoteControl, hasClients as hasRemoteControlClients } from '../routes/remoteControl';
import { licenseService } from '../../core/license';

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
  private loopRunning = false;
  private starting = false;

  /** 设置远程控制要操作的默认账号（主页第一个账号） */
  setDefaultAccount(accountId: string): void {
    this.defaultAccountId = accountId;
  }

  /** 前端调用：上报"正在启动游戏"状态，会立即推 status 给云端 */
  setStarting(starting: boolean): void {
    if (this.starting === starting) return;
    this.starting = starting;
    this.pushStatus();
  }

  /** 手机发来 start_loop：广播 SSE 让 Home.tsx 触发 handleStartAll */
  async startLoop(): Promise<{ success: boolean; error?: string }> {
    if (!hasRemoteControlClients()) {
      return { success: false, error: 'Electron 窗口未打开，请先打开 Electron' };
    }
    // 兜底：任何 start 之前先通知云端清空历史日志（本地日志由 Home.tsx 的 handleStartAll 清）
    remoteClient.pushLogClear();
    emitRemoteControl('start_loop');
    return { success: true };
  }

  /** 手机发来 stop_loop：广播 SSE 让 Home.tsx 触发 handleStop */
  async stopLoop(): Promise<{ success: boolean; error?: string }> {
    if (!hasRemoteControlClients()) {
      return { success: false, error: 'Electron 窗口未打开' };
    }
    emitRemoteControl('stop_loop');
    return { success: true };
  }

  /** 前端调用：上报当前 loopRunning 值。会立即推 status 给云端 */
  setLoopRunning(running: boolean): void {
    if (this.loopRunning === running) return;
    this.loopRunning = running;
    this.pushStatus();
  }

  async startTask(name: string, params?: any): Promise<{ success: boolean; error?: string }> {
    const mapping = ACTION_MAP[name];
    if (!mapping) return { success: false, error: `未知任务: ${name}` };

    // 远程 WS 链路同样要过许可校验（HTTP 侧由 licenseGuard 拦截，这里补上 WS 入口）
    const license = await licenseService.getStatus();
    if (!license.activated) {
      return { success: false, error: '许可证未激活或设备不匹配' };
    }
    if (license.isExpired) {
      return { success: false, error: '许可证已过期' };
    }
    if (license.isOffline) {
      return { success: false, error: '许可证离线验证超时，请联网后重试' };
    }

    // 远程未显式选择账号时，自动用第一个账号
    let accountId = this.defaultAccountId;
    if (!accountId) {
      const accounts = await accountService.listAccounts();
      if (accounts.length === 0) return { success: false, error: '本机尚未创建账号' };
      accountId = accounts[0].id;
    }

    // 设备连接检查：未连接时尝试连一次，失败就返回错误
    const status = deviceService.getStatus(accountId);
    if (!status.connected) {
      const result = await deviceService.connect(accountId);
      if (!result.connected) {
        return { success: false, error: `设备未连接：${result.message}` };
      }
    }

    try {
      const task = taskService.createTask(accountId, mapping.pluginId, mapping.actionId, params || {});
      // 异步执行，不等结果。任务结束后推送一次状态
      taskService.runTask(task.id)
        .catch(e => console.error('[Remote] task error:', e))
        .finally(() => this.pushStatus());
      // 立刻推一次状态，让浏览器/电脑端 UI 同步到"运行中"
      this.pushStatus();
      return { success: true };
    } catch (e: any) {
      return { success: false, error: e.message || String(e) };
    }
  }

  /** 主动把当前状态推到 VPS（所有连接的浏览器会收到） */
  pushStatus(): void {
    remoteClient.pushStatus(this.getStatus());
  }

  async stopAllTasks(): Promise<{ success: boolean; error?: string }> {
    try {
      const tasks = taskService.listTasks().filter(t => t.status === 'running' || t.status === 'pending');
      for (const t of tasks) taskService.stopTask(t.id);
      // 停止后立刻推一次状态
      this.pushStatus();
      return { success: true };
    } catch (e: any) {
      return { success: false, error: e.message || String(e) };
    }
  }

  getStatus(): StatusData {
    const tasks = taskService.listTasks().filter(t => t.status === 'running');
    const runningTasks = tasks.map(t => `${t.pluginId}:${t.actionId}`);
    if (this.loopRunning) runningTasks.push('home-loop:running');
    return {
      online: true,
      runningTasks,
      starting: this.starting,
    };
  }
}

export const remoteContextService = new RemoteContextService();

/** 在 server 启动时调用一次：把 CommandHandler 接到 RemoteClient */
export function wireRemoteControl(): void {
  commandHandler.setContext(remoteContextService);
  remoteClient.onCommand(async (cmd) => commandHandler.handle(cmd));
  remoteClient.onStatusRequest(() => remoteContextService.getStatus());
  // 周期性推送状态，浏览器/手机端刷新或新连接后能拿到运行状态
  setInterval(() => {
    if (remoteClient.isConnected()) remoteContextService.pushStatus();
  }, 5000);
  console.log('[Remote] command handler wired');
}
