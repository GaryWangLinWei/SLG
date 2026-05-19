import Router from 'koa-router';
import { configService } from '../services/ConfigService';

const router = new Router({ prefix: '/api/config' });

// GET /api/config/rok?accountId=xxx — 返回激活配置（兼容旧版）
// GET /api/config/rok?accountId=xxx&name=yyy — 返回指定配置
router.get('/rok', async (ctx) => {
  const accountId = ctx.query.accountId as string;
  const name = ctx.query.name as string | undefined;

  if (!accountId) {
    ctx.status = 400;
    ctx.body = { success: false, error: 'accountId 必填' };
    return;
  }

  const config = name
    ? await configService.loadConfigByName(accountId, name)
    : await configService.loadConfig(accountId);
  ctx.body = { success: true, config };
});

// PUT /api/config/rok?accountId=xxx&name=yyy — 保存配置
router.put('/rok', async (ctx) => {
  const accountId = ctx.query.accountId as string;
  const name = ctx.query.name as string;

  if (!accountId || !name) {
    ctx.status = 400;
    ctx.body = { success: false, error: 'accountId 和 name 必填' };
    return;
  }

  const config = ctx.request.body;
  if (!config || typeof config !== 'object') {
    ctx.status = 400;
    ctx.body = { success: false, error: '请求体必须是 JSON 对象' };
    return;
  }

  await configService.saveConfig(accountId, name, config);
  ctx.body = { success: true };
});

// GET /api/config/rok/profiles?accountId=xxx — 列出所有配置
router.get('/rok/profiles', async (ctx) => {
  const accountId = ctx.query.accountId as string;
  if (!accountId) {
    ctx.status = 400;
    ctx.body = { success: false, error: 'accountId 必填' };
    return;
  }

  const result = await configService.listProfiles(accountId);
  ctx.body = { success: true, ...result };
});

// POST /api/config/rok/switch?accountId=xxx — 切换激活配置
router.post('/rok/switch', async (ctx) => {
  const accountId = ctx.query.accountId as string;
  if (!accountId) {
    ctx.status = 400;
    ctx.body = { success: false, error: 'accountId 必填' };
    return;
  }

  const { name } = (ctx.request.body as any) || {};
  if (!name) {
    ctx.status = 400;
    ctx.body = { success: false, error: 'name 必填' };
    return;
  }

  try {
    await configService.switchProfile(accountId, name as string);
    ctx.body = { success: true };
  } catch (e: any) {
    ctx.status = 400;
    ctx.body = { success: false, error: e.message };
  }
});

// POST /api/config/rok/create?accountId=xxx — 创建新配置
router.post('/rok/create', async (ctx) => {
  const accountId = ctx.query.accountId as string;
  if (!accountId) {
    ctx.status = 400;
    ctx.body = { success: false, error: 'accountId 必填' };
    return;
  }

  const { name } = (ctx.request.body as any) || {};
  if (!name) {
    ctx.status = 400;
    ctx.body = { success: false, error: 'name 必填' };
    return;
  }

  try {
    await configService.createProfile(accountId, name as string);
    ctx.body = { success: true };
  } catch (e: any) {
    ctx.status = 400;
    ctx.body = { success: false, error: e.message };
  }
});

// DELETE /api/config/rok?accountId=xxx&name=yyy — 删除配置
router.delete('/rok', async (ctx) => {
  const accountId = ctx.query.accountId as string;
  const name = ctx.query.name as string;

  if (!accountId || !name) {
    ctx.status = 400;
    ctx.body = { success: false, error: 'accountId 和 name 必填' };
    return;
  }

  try {
    await configService.deleteProfile(accountId, name);
    ctx.body = { success: true };
  } catch (e: any) {
    ctx.status = 400;
    ctx.body = { success: false, error: e.message };
  }
});

// POST /api/config/rok/rename?accountId=xxx — 重命名配置
router.post('/rok/rename', async (ctx) => {
  const accountId = ctx.query.accountId as string;
  if (!accountId) {
    ctx.status = 400;
    ctx.body = { success: false, error: 'accountId 必填' };
    return;
  }

  const { oldName, newName } = (ctx.request.body as any) || {};
  if (!oldName || !newName) {
    ctx.status = 400;
    ctx.body = { success: false, error: 'oldName 和 newName 必填' };
    return;
  }

  try {
    await configService.renameProfile(accountId, oldName as string, newName as string);
    ctx.body = { success: true };
  } catch (e: any) {
    ctx.status = 400;
    ctx.body = { success: false, error: e.message };
  }
});

export default router;
