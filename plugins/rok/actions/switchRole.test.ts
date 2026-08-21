import * as path from 'path';
import { switchRole, SURELOGIN_POLL_TIMES } from './switchRole';
import { getTemplatesDir } from '../../../core/resourcePath';
import * as locationUtil from '../utils/location';

jest.mock('../utils/location', () => ({ getCurrentLocation: jest.fn() }));

function makeCtx(overrides: Partial<any> = {}): any {
  const taps: Array<{ x: number; y: number }> = [];
  const swipes: Array<{ x1: number; y1: number; x2: number; y2: number }> = [];
  const ctx = {
    taps,
    swipes,
    sleep: jest.fn(async () => {}),
    tap: jest.fn(async (x: number, y: number) => { taps.push({ x, y }); }),
    swipe: jest.fn(async (x1: number, y1: number, x2: number, y2: number) => { swipes.push({ x1, y1, x2, y2 }); }),
    log: jest.fn(),
    findImageWithLocation: jest.fn(),
    ...overrides,
  };
  return ctx;
}

const ICON_ROLE = path.join(getTemplatesDir(), 'icon_role.png');
const BTN_SURELOGIN = path.join(getTemplatesDir(), 'btn_surelogin.png');

/** 角色图标找到、确认登录也找到（真实切换成功路径） */
function findAllOk() {
  return jest.fn(async (p: string) => {
    if (p === ICON_ROLE) return { found: true, x: 200, y: 300, confidence: 0.9 };
    if (p === BTN_SURELOGIN) return { found: true, x: 1000, y: 640, confidence: 0.9 };
    return { found: false, x: 0, y: 0, confidence: 0 };
  });
}

beforeEach(() => { (locationUtil.getCurrentLocation as jest.Mock).mockResolvedValue('city'); });

test('starredIndex=1 点第 1 号位 (320,334)，不翻页', async () => {
  const ctx = makeCtx({ findImageWithLocation: findAllOk() });
  const result = await switchRole(ctx as any, 1);
  expect(result).toBe('success');
  expect(ctx.taps).toContainEqual({ x: 320, y: 334 });
  // 只有归顶的下滑，没有向上翻页
  expect(ctx.swipes.every((s: any) => s.y2 > s.y1)).toBe(true);
});

test('starredIndex=4 点第 4 号位 (909,502)', async () => {
  const ctx = makeCtx({ findImageWithLocation: findAllOk() });
  const result = await switchRole(ctx as any, 4);
  expect(result).toBe('success');
  expect(ctx.taps).toContainEqual({ x: 909, y: 502 });
});

test('starredIndex=6 点第 6 号位 (909,670) —— 第 6 位是右列', async () => {
  const ctx = makeCtx({ findImageWithLocation: findAllOk() });
  const result = await switchRole(ctx as any, 6);
  expect(result).toBe('success');
  expect(ctx.taps).toContainEqual({ x: 909, y: 670 });
});

test('starredIndex=7 翻 1 页后点第 1 号位', async () => {
  const ctx = makeCtx({ findImageWithLocation: findAllOk() });
  const result = await switchRole(ctx as any, 7);
  expect(result).toBe('success');
  // 有向上滑（翻页）动作：y2 < y1
  expect(ctx.swipes.some((s: any) => s.y2 < s.y1)).toBe(true);
  expect(ctx.taps).toContainEqual({ x: 320, y: 334 });
});

test('starredIndex=13 翻 2 页', async () => {
  const ctx = makeCtx({ findImageWithLocation: findAllOk() });
  const result = await switchRole(ctx as any, 13);
  expect(result).toBe('success');
  const pageUps = ctx.swipes.filter((s: any) => s.y2 < s.y1);
  expect(pageUps.length).toBe(2);
});

test('空操作分支：点击后没出现确认登录 → already_active，逐层关 3 个界面', async () => {
  const ctx = makeCtx({
    findImageWithLocation: jest.fn(async (p: string) => {
      if (p === ICON_ROLE) return { found: true, x: 200, y: 300, confidence: 0.9 };
      if (p === BTN_SURELOGIN) return { found: false, x: 0, y: 0, confidence: 0.2 };
      return { found: false, x: 0, y: 0, confidence: 0 };
    }),
  });
  const result = await switchRole(ctx as any, 2);
  expect(result).toBe('already_active');
  expect(ctx.taps).toContainEqual({ x: 1366, y: 105 });   // 关角色管理
  expect(ctx.taps).toContainEqual({ x: 1394, y: 55 });    // 关设置
  expect(ctx.taps).toContainEqual({ x: 1454, y: 88 });    // 关玩家页
});

test('找不到角色管理入口：关设置与玩家页，返回 not_found', async () => {
  const ctx = makeCtx({
    findImageWithLocation: jest.fn(async () => ({ found: false, x: 0, y: 0, confidence: 0.1 })),
  });
  const result = await switchRole(ctx as any, 1);
  expect(result).toBe('not_found');
  expect(ctx.taps).toContainEqual({ x: 1394, y: 55 });
  expect(ctx.taps).toContainEqual({ x: 1454, y: 88 });
  expect(ctx.taps).not.toContainEqual({ x: 320, y: 334 });
});

test('starredIndex 非正整数 → invalid_index，不做任何点击', async () => {
  const ctx = makeCtx({ findImageWithLocation: findAllOk() });
  expect(await switchRole(ctx as any, 0)).toBe('invalid_index');
  expect(await switchRole(ctx as any, -1)).toBe('invalid_index');
  expect(await switchRole(ctx as any, 1.5)).toBe('invalid_index');
  expect(ctx.taps).toEqual([]);
});

test('确认登录第 3 次轮询才出现 → success（不是 already_active）', async () => {
  let sureloginCalls = 0;
  const ctx = makeCtx({
    findImageWithLocation: jest.fn(async (p: string) => {
      if (p === ICON_ROLE) return { found: true, x: 200, y: 300, confidence: 0.9 };
      if (p === BTN_SURELOGIN) {
        sureloginCalls += 1;
        // 前 2 次未渲染，第 3 次才出现：不应被误判成"已在目标角色"
        if (sureloginCalls < 3) return { found: false, x: 0, y: 0, confidence: 0.2 };
        return { found: true, x: 1000, y: 640, confidence: 0.9 };
      }
      return { found: false, x: 0, y: 0, confidence: 0 };
    }),
  });
  const result = await switchRole(ctx as any, 1);
  expect(result).toBe('success');
  expect(ctx.taps).not.toContainEqual({ x: 1366, y: 105 }); // 未点关闭角色管理，说明走了真实切换分支
  expect(ctx.taps).toContainEqual({ x: 320, y: 334 });       // 已点目标位
});

test('确认登录始终未出现时，轮询次数有界 = SURELOGIN_POLL_TIMES', async () => {
  let sureloginCalls = 0;
  const ctx = makeCtx({
    findImageWithLocation: jest.fn(async (p: string) => {
      if (p === ICON_ROLE) return { found: true, x: 200, y: 300, confidence: 0.9 };
      if (p === BTN_SURELOGIN) { sureloginCalls += 1; return { found: false, x: 0, y: 0, confidence: 0.2 }; }
      return { found: false, x: 0, y: 0, confidence: 0 };
    }),
  });
  const result = await switchRole(ctx as any, 1);
  expect(result).toBe('already_active');
  // 锁死终止性：恒未命中时检测次数恰为轮询上限，防止将来改成无限循环
  expect(sureloginCalls).toBe(SURELOGIN_POLL_TIMES);
});