import { pluginService } from './PluginService';
import { configService } from './ConfigService';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';

const LOG_DIR = path.join(os.homedir(), '.slg-automation', 'logs');

// Clean up log files older than 7 days
async function cleanupOldLogs(): Promise<void> {
  try {
    const files = await fs.readdir(LOG_DIR);
    const now = Date.now();
    const sevenDays = 7 * 24 * 60 * 60 * 1000;
    for (const file of files) {
      if (!file.endsWith('.log')) continue;
      const filePath = path.join(LOG_DIR, file);
      const stat = await fs.stat(filePath);
      if (now - stat.mtimeMs > sevenDays) {
        await fs.unlink(filePath);
      }
    }
  } catch { /* directory doesn't exist yet */ }
}

async function writeLog(accountId: string, message: string): Promise<void> {
  try {
    const date = new Date().toISOString().slice(0, 10);
    const logFile = path.join(LOG_DIR, accountId, `${date}.log`);
    const dir = path.dirname(logFile);
    await fs.mkdir(dir, { recursive: true });
    await fs.appendFile(logFile, message + '\n', 'utf-8');
  } catch { /* best effort */ }
}

export { LOG_DIR };

export type TaskStatus = 'pending' | 'running' | 'completed' | 'error' | 'stopped';

export interface Task {
  id: string;
  accountId: string;
  pluginId: string;
  actionId: string;
  config: Record<string, any>;
  status: TaskStatus;
  startTime?: Date;
  endTime?: Date;
  logs: string[];
  error?: string;
  stopRequested?: boolean;
}

class TaskService {
  private tasks: Map<string, Task> = new Map();
  private abortControllers: Map<string, AbortController> = new Map();

  createTask(accountId: string, pluginId: string, actionId: string, config: Record<string, any> = {}): Task {
    const id = `task_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    const task: Task = {
      id,
      accountId,
      pluginId,
      actionId,
      config,
      status: 'pending',
      logs: [],
      stopRequested: false
    };
    this.tasks.set(id, task);
    return task;
  }

  getTask(id: string): Task | undefined {
    return this.tasks.get(id);
  }

  listTasks(): Task[] {
    return Array.from(this.tasks.values()).reverse();
  }

  stopTask(taskId: string): { success: boolean; message: string } {
    const task = this.tasks.get(taskId);
    if (!task) {
      return { success: false, message: '任务不存在' };
    }

    if (task.status !== 'running') {
      return { success: false, message: '任务未在运行' };
    }

    task.stopRequested = true;
    const abort = this.abortControllers.get(taskId);
    if (abort) {
      abort.abort();
    }

    task.status = 'stopped';
    task.endTime = new Date();
    task.logs.push(`[${new Date().toLocaleTimeString()}] 任务已手动停止`);
    return { success: true, message: '任务已停止' };
  }

  async runTask(taskId: string): Promise<Task> {
    const task = this.tasks.get(taskId);
    if (!task) {
      throw new Error(`Task ${taskId} not found`);
    }

    // Clean up old logs (best-effort)
    cleanupOldLogs();

    const abort = new AbortController();
    this.abortControllers.set(taskId, abort);

    const checkStop = () => {
      if (task.stopRequested) {
        throw new Error('Task stopped by user');
      }
    };

    task.status = 'running';
    task.startTime = new Date();
    task.stopRequested = false;
    task.logs.push(`[${new Date().toLocaleTimeString()}] 任务开始执行`);

    // Per-task logger: writes to task.logs AND persistent log file
    const logCallback = (msg: string) => {
      const entry = `[${new Date().toLocaleTimeString()}] ${msg}`;
      task.logs.push(entry);
      writeLog(task.accountId, msg);
      console.log(`[Task ${taskId.slice(-6)}] ${msg}`);
    };

    try {
      // Load user config for this account
      const rokConfig = await configService.loadConfig(task.accountId);
      const actionConfig = {
        ...task.config,
        rokConfig: {
          ...rokConfig,
          ...task.config?.rokConfig
        }
      };

      await pluginService
        .getPluginManager(task.accountId)
        .runAction(task.pluginId, task.actionId, actionConfig, checkStop, logCallback);

      if (task.stopRequested) {
        task.status = 'stopped';
        task.logs.push(`[${new Date().toLocaleTimeString()}] 任务已手动停止`);
      } else {
        task.status = 'completed';
        task.logs.push(`[${new Date().toLocaleTimeString()}] 任务执行完成`);
      }
    } catch (error) {
      if (String(error).includes('Task stopped by user')) {
        task.status = 'stopped';
        task.logs.push(`[${new Date().toLocaleTimeString()}] 任务已手动停止`);
      } else {
        task.status = 'error';
        task.error = String(error);
        task.logs.push(`[${new Date().toLocaleTimeString()}] 任务失败: ${error}`);
      }
    } finally {
      this.abortControllers.delete(taskId);
    }

    task.endTime = new Date();
    return task;
  }
}

export const taskService = new TaskService();
