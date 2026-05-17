import Router from 'koa-router';
import * as fs from 'fs/promises';
import * as path from 'path';
import { taskService, LOG_DIR } from '../services/TaskService';

const router = new Router({ prefix: '/api/tasks' });

router.get('/', async (ctx) => {
  ctx.body = {
    success: true,
    tasks: taskService.listTasks()
  };
});

// GET /api/tasks/summary — 所有账号任务状态汇总
router.get('/summary', async (ctx) => {
  const tasks = taskService.listTasks();
  const summary: Record<string, {
    running: number;
    completed: number;
    error: number;
    lastTask?: { id: string; actionId: string; endedAt?: string; status: string };
  }> = {};

  for (const t of tasks) {
    if (!summary[t.accountId]) {
      summary[t.accountId] = { running: 0, completed: 0, error: 0 };
    }
    const s = summary[t.accountId];
    if (t.status === 'running') s.running++;
    if (t.status === 'completed') s.completed++;
    if (t.status === 'error') s.error++;
    if (!s.lastTask || !s.lastTask.endedAt || (t.endTime && t.endTime.getTime() > new Date(s.lastTask.endedAt).getTime())) {
      s.lastTask = { id: t.id, actionId: t.actionId, endedAt: t.endTime?.toString(), status: t.status };
    }
  }

  ctx.body = { success: true, summary, taskCount: tasks.length };
});

router.get('/:id', async (ctx) => {
  const task = taskService.getTask(ctx.params.id);
  if (!task) {
    ctx.status = 404;
    ctx.body = { success: false, error: 'Task not found' };
    return;
  }
  ctx.body = { success: true, task };
});

router.post('/', async (ctx) => {
  const body = ctx.request.body as any;
  const { accountId, pluginId, actionId, config = {} } = body;
  if (!accountId) {
    ctx.status = 400;
    ctx.body = { success: false, error: 'accountId is required' };
    return;
  }
  if (!pluginId || !actionId) {
    ctx.status = 400;
    ctx.body = { success: false, error: 'pluginId and actionId are required' };
    return;
  }

  const task = taskService.createTask(accountId, pluginId, actionId, config);
  ctx.body = { success: true, task };
});

router.post('/:id/run', async (ctx) => {
  try {
    const task = await taskService.runTask(ctx.params.id);
    ctx.body = { success: true, task };
  } catch (error) {
    ctx.status = 500;
    ctx.body = { success: false, error: String(error) };
  }
});

router.post('/:id/stop', async (ctx) => {
  const result = taskService.stopTask(ctx.params.id);
  ctx.body = { success: result.success, message: result.message };
});

// GET /api/tasks/logs/list?accountId=xxx — list available log files for an account
router.get('/logs/list', async (ctx) => {
  const accountId = ctx.query.accountId as string;
  try {
    const logDir = accountId ? path.join(LOG_DIR, accountId) : LOG_DIR;
    const files = await fs.readdir(logDir);
    const logFiles = files
      .filter(f => f.endsWith('.log'))
      .sort()
      .reverse();
    ctx.body = { success: true, files: logFiles };
  } catch {
    ctx.body = { success: true, files: [] };
  }
});

// GET /api/tasks/logs/:date?accountId=xxx — read a specific log file
router.get('/logs/:date', async (ctx) => {
  const accountId = ctx.query.accountId as string;
  try {
    const date = ctx.params.date;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      ctx.status = 400;
      ctx.body = { success: false, error: '日期格式错误，需为 YYYY-MM-DD' };
      return;
    }
    const logDir = accountId ? path.join(LOG_DIR, accountId) : LOG_DIR;
    const filePath = path.join(logDir, `${date}.log`);
    const content = await fs.readFile(filePath, 'utf-8');
    ctx.body = { success: true, date, lines: content.split('\n').filter(Boolean) };
  } catch {
    ctx.status = 404;
    ctx.body = { success: false, error: '该日期无日志' };
  }
});

export default router;
