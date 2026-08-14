import { upgradeSingleBuilding } from './upgradeBuildings';
import { PluginContext } from '../../../core/plugin';
import { DEFAULT_ROK_CONFIG } from '../index';

function basename(p: string): string {
  return p.split(/[\\/]/).pop() || p;
}

function makeCtx(script: {
  // 模板名 → 第几次调用的 found 序列；未列出默认 found=true
  detailFoundSequence?: boolean[];
  qianzhiFound?: boolean;
}): jest.Mocked<PluginContext> {
  let detailCall = 0;
  const taps: Array<[number, number]> = [];

  const ctx = {
    log: jest.fn(),
    sleep: jest.fn().mockResolvedValue(undefined),
    tap: jest.fn().mockImplementation(async (x: number, y: number) => { taps.push([x, y]); }),
    tapRect: jest.fn().mockResolvedValue(undefined),
    swipe: jest.fn().mockResolvedValue(undefined),
    detectState: jest.fn().mockResolvedValue({ state: 'city', diffs: { city: 0.1, world: 0.9 } }),
    captureRegion: jest.fn().mockResolvedValue('fake-region.png'),
    compareImages: jest.fn().mockResolvedValue(1.0), // 无 busy/无资源不足 → 直接成功
    findImageWithLocation: jest.fn().mockImplementation(async (template: string) => {
      const name = basename(template);
      if (name === 'detailUpgradeButton.png') {
        const seq = script.detailFoundSequence ?? [true];
        const found = seq[Math.min(detailCall, seq.length - 1)];
        detailCall++;
        return { found, x: 700, y: 600, confidence: found ? 0.95 : 0.2 };
      }
      if (name === 'btn_qianzhi.png') {
        const found = script.qianzhiFound ?? false;
        return { found, x: 800, y: 700, confidence: found ? 0.95 : 0.2 };
      }
      // btn_upgrade.png 等默认找到
      return { found: true, x: 800, y: 450, confidence: 0.95 };
    }),
    getScreenshot: jest.fn(),
    getConfig: jest.fn((key: string) => (DEFAULT_ROK_CONFIG as any)[key]),
    __taps: taps,
  } as any;
  return ctx;
}

describe('upgradeSingleBuilding prerequisite handling', () => {
  const config = {
    ...DEFAULT_ROK_CONFIG,
    buildingPositions: { 市政厅: { x: 400, y: 400 } },
  };

  it('taps the prerequisite button and retries upgrade when detail button is missing', async () => {
    // 第一次进详情页找不到升级按钮（有前置），点前置后第二次找到
    const ctx = makeCtx({ detailFoundSequence: [false, true], qianzhiFound: true });

    const result = await upgradeSingleBuilding(ctx, config as any, '市政厅');

    expect(result).toBe('success');

    // 应点击过前置按钮 btn_qianzhi.png 的位置 (800,700)
    const taps = (ctx as any).__taps as Array<[number, number]>;
    expect(taps).toContainEqual([800, 700]);

    // 详情升级按钮被找到并点击了一次（第二次调用时）
    expect(taps).toContainEqual([700, 600]);

    // 成功后请求盟友帮助 (800,450)
    expect(taps).toContainEqual([800, 450]);
  });

  it('follows a prerequisite chain up to MAX depth, then upgrades the leaf', async () => {
    // 前两次详情页都无升级按钮（连续两个前置），第三次才出现
    const ctx = makeCtx({ detailFoundSequence: [false, false, true], qianzhiFound: true });

    const result = await upgradeSingleBuilding(ctx, config as any, '市政厅');

    expect(result).toBe('success');
    const taps = (ctx as any).__taps as Array<[number, number]>;
    // 前置按钮被点了两次
    const prereqTaps = taps.filter(([x, y]) => x === 800 && y === 700);
    expect(prereqTaps).toHaveLength(2);
    // 最终点到详情升级
    expect(taps).toContainEqual([700, 600]);
  });

  it('exits with no_upgrade_button when neither detail nor prerequisite button found', async () => {
    const ctx = makeCtx({ detailFoundSequence: [false], qianzhiFound: false });

    const result = await upgradeSingleBuilding(ctx, config as any, '市政厅');

    expect(result).toBe('no_upgrade_button');
    const taps = (ctx as any).__taps as Array<[number, number]>;
    // 没点前置，也没点详情升级
    expect(taps).not.toContainEqual([800, 700]);
    expect(taps).not.toContainEqual([700, 600]);
  });
});
