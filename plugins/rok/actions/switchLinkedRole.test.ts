import * as path from 'path';
import { switchLinkedRole } from './switchLinkedRole';
import { getTemplatesDir } from '../../../core/resourcePath';
import * as locationUtil from '../utils/location';

jest.mock('../utils/location', () => ({ getCurrentLocation: jest.fn() }));

function makeCtx(overrides: Partial<any> = {}): any {
  const taps: Array<{ x: number; y: number }> = [];
  const ctx = {
    taps,
    sleep: jest.fn(async () => {}),
    tap: jest.fn(async (x: number, y: number) => { taps.push({ x, y }); }),
    log: jest.fn(),
    findImageWithLocation: jest.fn(),
    ...overrides,
  };
  return ctx;
}

const ICON_ROLE = path.join(getTemplatesDir(), 'icon_role.png');
const BTN_SURELOGIN = path.join(getTemplatesDir(), 'btn_surelogin.png');

beforeEach(() => { (locationUtil.getCurrentLocation as jest.Mock).mockResolvedValue('city'); });

test('main-to-linked：点右侧连体角色 (909,334)', async () => {
  const ctx = makeCtx({
    findImageWithLocation: jest.fn(async (p: string) => {
      if (p === ICON_ROLE) return { found: true, x: 200, y: 300, confidence: 0.9 };
      if (p === BTN_SURELOGIN) return { found: true, x: 1000, y: 640, confidence: 0.9 };
      return { found: false, x: 0, y: 0, confidence: 0 };
    }),
  });
  const result = await switchLinkedRole(ctx as any, 'main-to-linked');
  expect(result).toBe('success');
  expect(ctx.taps).toContainEqual({ x: 909, y: 334 });
  expect(ctx.taps).not.toContainEqual({ x: 320, y: 334 });
  expect(ctx.taps).not.toContainEqual({ x: 1394, y: 55 });
  expect(ctx.taps).not.toContainEqual({ x: 1454, y: 88 });
});

test('linked-to-main：点左侧主号 (320,334)', async () => {
  const ctx = makeCtx({
    findImageWithLocation: jest.fn(async (p: string) => {
      if (p === ICON_ROLE) return { found: true, x: 200, y: 300, confidence: 0.9 };
      if (p === BTN_SURELOGIN) return { found: true, x: 1000, y: 640, confidence: 0.9 };
      return { found: false, x: 0, y: 0, confidence: 0 };
    }),
  });
  const result = await switchLinkedRole(ctx as any, 'linked-to-main');
  expect(result).toBe('success');
  expect(ctx.taps).toContainEqual({ x: 320, y: 334 });
  expect(ctx.taps).not.toContainEqual({ x: 909, y: 334 });
});

test('找不到角色按钮：关闭设置与玩家页，返回 not_found', async () => {
  const ctx = makeCtx({
    findImageWithLocation: jest.fn(async (p: string) =>
      p === ICON_ROLE ? { found: false, x: 0, y: 0, confidence: 0.2 }
      : { found: false, x: 0, y: 0, confidence: 0 }),
  });
  const result = await switchLinkedRole(ctx as any, 'main-to-linked');
  expect(result).toBe('not_found');
  expect(ctx.taps).toContainEqual({ x: 1394, y: 55 });
  expect(ctx.taps).toContainEqual({ x: 1454, y: 88 });
  expect(ctx.taps).not.toContainEqual({ x: 1366, y: 105 });
  expect(ctx.taps).not.toContainEqual({ x: 909, y: 334 });
});

test('找不到确认登录：关闭角色管理、设置、玩家页，返回 not_found', async () => {
  const ctx = makeCtx({
    findImageWithLocation: jest.fn(async (p: string) =>
      p === ICON_ROLE ? { found: true, x: 200, y: 300, confidence: 0.9 }
      : p === BTN_SURELOGIN ? { found: false, x: 0, y: 0, confidence: 0.2 }
      : { found: false, x: 0, y: 0, confidence: 0 }),
  });
  const result = await switchLinkedRole(ctx as any, 'main-to-linked');
  expect(result).toBe('not_found');
  expect(ctx.taps).toContainEqual({ x: 909, y: 334 });
  expect(ctx.taps).toContainEqual({ x: 1366, y: 105 });
  expect(ctx.taps).toContainEqual({ x: 1394, y: 55 });
  expect(ctx.taps).toContainEqual({ x: 1454, y: 88 });
});
