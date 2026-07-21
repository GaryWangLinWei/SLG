import { Vision } from '../../../core/vision';
import * as fsSync from 'fs';
import * as path from 'path';
import * as fsPromises from 'fs/promises';
import { createSpiralState, isGemOccupied, nextGemSearchPauseSeconds, searchAndClickGem, verifyGemAtCenter } from './gatherGem';
import { ocrService } from '../../../core/ocr/OcrService';

jest.mock('fs/promises', () => ({
  unlink: jest.fn(async () => {}),
  mkdir: jest.fn(async () => {}),
  copyFile: jest.fn(async () => {}),
}));

describe('gatherGem 螺旋搜索等待', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('多数情况下等待 1.3~2.0 秒', () => {
    jest.spyOn(Math, 'random')
      .mockReturnValueOnce(0.5)
      .mockReturnValueOnce(0.5);

    expect(nextGemSearchPauseSeconds()).toBeCloseTo(1.65);
  });

  it('少数情况下等待 2.2~3.2 秒', () => {
    jest.spyOn(Math, 'random')
      .mockReturnValueOnce(0.92)
      .mockReturnValueOnce(0.5);

    expect(nextGemSearchPauseSeconds()).toBeCloseTo(2.7);
  });

  it('极少数情况下等待 3.4~5.4 秒', () => {
    jest.spyOn(Math, 'random')
      .mockReturnValueOnce(0.985)
      .mockReturnValueOnce(0.5);

    expect(nextGemSearchPauseSeconds()).toBeCloseTo(4.4);
  });
});

describe('gatherGem 螺旋搜索状态', () => {
  it('随机化起始方向、搜索中心和最大搜索步数', () => {
    const randomSpy = jest.spyOn(Math, 'random')
      .mockReturnValueOnce(0.75) // dirIndex = 3
      .mockReturnValueOnce(0.25) // centerX = 780
      .mockReturnValueOnce(0.8)  // centerY = 465
      .mockReturnValueOnce(1);   // maxAttempts = 110%

    const state = createSpiralState({
      gemGather: {
        spiralSwipeRatio: 0.5,
        spiralSwipeRatioH: 0.6,
        searchMaxAttempts: 30,
      },
    } as any);

    expect(state.dirIndex).toBe(3);
    expect(state.centerX).toBe(780);
    expect(state.centerY).toBe(465);
    expect(state.maxAttempts).toBe(33);
    expect(state.halfW).toBe(Math.round(1600 * 0.6 / 2));
    expect(state.halfH).toBe(Math.round(900 * 0.5 / 2));

    randomSpy.mockRestore();
  });
});

describe('gatherGem 点击前占用检测', () => {
  it('截取宝石上方 80x110 区域，并检测 state_caiji.png', async () => {
    const findImage = jest
      .spyOn(Vision.prototype, 'findImage')
      .mockResolvedValue({
        found: false,
        confidence: 0,
        location: { x: 0, y: 0 },
        rect: { x: 0, y: 0, width: 0, height: 0 },
      } as any);

    const ctx: any = {
      captureRegion: jest.fn(async () => 'temp-occupied-region.png'),
      detectImage: jest.fn(async () => []),
      detectHeroWithScreenshot: jest.fn(async () => []),
      log: jest.fn(),
    };

    const occupied = await isGemOccupied(ctx, 800, 450);

    expect(occupied).toBe(false);
    expect(ctx.captureRegion).toHaveBeenCalledWith(760, 340, 80, 110);
    // 新版本 isGemOccupied 使用锄头模板（红色锄头.png、蓝色锄头.png）
    expect(findImage.mock.calls.map(call => call[1].replace(/\\/g, '/')))
      .toContainEqual(expect.stringContaining('/红色锄头.png'));
    expect(ctx.detectHeroWithScreenshot).toHaveBeenCalledWith(0.5, [0]);

    findImage.mockRestore();
  });
});

describe('verifyGemAtCenter bigGem detection', () => {
  it('bigGem hit returns full-screen coordinates from detection center', async () => {
    const detectBigGemImage = jest.fn(async () => [
      { x: 150, y: 120, width: 80, height: 80, confidence: 0.92, classIndex: 0 },
    ]);
    const ctx: any = {
      captureRegion: jest.fn(async () => 'temp-verify-region.png'),
      detectBigGemImage,
      log: jest.fn(),
    };

    const result = await verifyGemAtCenter(ctx);

    expect(result.found).toBe(true);
    // GEM_VERIFY_REGION = { x: 650, y: 300, w: 300, h: 300 }
    // Detection(150, 120) + offset(650, 300) = (800, 420)
    expect(result.x).toBe(800);
    expect(result.y).toBe(420);
    expect(detectBigGemImage).toHaveBeenCalledWith('temp-verify-region.png', 0.5, [0]);
  });

  it('no bigGem hit returns found=false', async () => {
    const ctx: any = {
      captureRegion: jest.fn(async () => 'temp-verify-region.png'),
      detectBigGemImage: jest.fn(async () => []),
      log: jest.fn(),
    };

    const result = await verifyGemAtCenter(ctx);

    expect(result.found).toBe(false);
    expect(result.x).toBeUndefined();
    expect(result.y).toBeUndefined();
  });

  it('multiple hits picks highest confidence', async () => {
    const detectBigGemImage = jest.fn(async () => [
      { x: 100, y: 100, width: 60, height: 60, confidence: 0.75, classIndex: 0 },
      { x: 200, y: 180, width: 70, height: 70, confidence: 0.88, classIndex: 0 },
      { x: 50,  y: 250, width: 55, height: 55, confidence: 0.81, classIndex: 0 },
    ]);
    const ctx: any = {
      captureRegion: jest.fn(async () => 'temp-verify-region.png'),
      detectBigGemImage,
      log: jest.fn(),
    };

    const result = await verifyGemAtCenter(ctx);

    expect(result.found).toBe(true);
    // best conf 0.88: (200, 180) + (650, 300) = (850, 480)
    expect(result.x).toBe(850);
    expect(result.y).toBe(480);
  });

  it('temporary region file is cleaned up on error', async () => {
    const ctx: any = {
      captureRegion: jest.fn(async () => 'temp-verify-region.png'),
      detectBigGemImage: jest.fn(async () => { throw new Error('inference error'); }),
      log: jest.fn(),
    };

    await expect(verifyGemAtCenter(ctx)).rejects.toThrow('inference error');
    expect(fsPromises.unlink).toHaveBeenCalledWith('temp-verify-region.png')
  });
});


describe('searchAndClickGem 源码流程顺序', () => {
  it('按候选点击、验证、caiji YOLO、坐标去重、verified 点击、采集按钮执行', () => {
    const source = fsSync.readFileSync(path.join(__dirname, 'gatherGem.ts'), 'utf8');
    const start = source.indexOf('export async function searchAndClickGem');
    const end = source.indexOf('export interface DispatchResult', start);
    const body = source.slice(start, end);

    const steps = [
      'await ctx.tap(gemX, gemY)',
      'await ctx.sleep(1.5)',
      'await verifyGemAtCenter(ctx)',
      "detectTeamStates(ctx, ['caiji'], caijiRegion)",
      'COORD_REGION.x, COORD_REGION.y, COORD_REGION.w, COORD_REGION.h',
      'await ctx.tap(verified.x!, verified.y!)',
      'await ctx.sleep(1)',
      'await ctx.findImageWithLocation(caijiBtnTemplate, 0.7)',
    ];
    let cursor = -1;
    for (const step of steps) {
      const next = body.indexOf(step, cursor + 1);
      expect(next).toBeGreaterThan(cursor);
      cursor = next;
    }

    expect(body).toContain('x: Math.max(0, verified.x! - 60)');
    expect(body).toContain('y: Math.max(0, verified.y! - 60)');
    expect(body).toContain('w: 120');
    expect(body).toContain('h: 120');
    expect(body).not.toContain(['PINCHED_GEM', 'TARGET_RECT'].join('_'));
    expect(body).not.toContain(['CAIJI_STATE', 'TEMPLATE'].join('_'));
    expect(body).not.toContain(['captureRegion(745', '360', '157', '142)'].join(', '));
  });
});


describe('searchAndClickGem 运行时流程', () => {
  const config: any = {
    gemGather: { caijiBtnTemplate: 'btn_caiji.png' },
    resourceCollect: { worldSwitchButton: { x: 82, y: 814 } },
  };

  function setup(options: {
    verify?: any[];
    caiji?: any[];
    coord?: string;
    buttonFound?: boolean;
  } = {}) {
    const events: string[] = [];
    const verify = options.verify ?? [{ x: 25, y: 35, confidence: 0.9, classIndex: 0 }];
    const caiji = options.caiji ?? [];
    let captureCount = 0;
    const ctx: any = {
      log: jest.fn(),
      detectWithScreenshot: jest.fn()
        .mockResolvedValueOnce([{ x: 700, y: 400, confidence: 0.9 }])
        .mockResolvedValue([]),
      captureRegion: jest.fn(async (...args: number[]) => {
        captureCount++;
        if (args[2] === 300) events.push('verify');
        if (args[2] === 120) events.push('caiji');
        if (args[0] === 400 && args[1] === 11) events.push('ocr');
        return `temp-${captureCount}.png`;
      }),
      detectHeroWithScreenshot: jest.fn(async () => []),
      detectBigGemImage: jest.fn(async () => verify),
      detectStateImage: jest.fn(async () => caiji),
      detectStateWithScreenshot: jest.fn(async () => caiji),
      tap: jest.fn(async (x: number, y: number) => {
        if (x === 675 && y === 335) events.push('verifiedTap');
        if (x === 1200 && y === 700) events.push('buttonTap');
      }),
      sleep: jest.fn(async () => {}),
      findImageWithLocation: jest.fn(async () => options.buttonFound === false
        ? { found: false, confidence: 0 }
        : { found: true, confidence: 0.9, x: 1200, y: 700 }),
      swipeAndHold: jest.fn(async () => {}), releaseHold: jest.fn(async () => {}),
      swipe: jest.fn(async () => {}), getScreenshot: jest.fn(async () => Buffer.alloc(0)),
    };
    jest.spyOn(Vision.prototype, 'findImage').mockResolvedValue({ found: false, confidence: 0 } as any);
    jest.spyOn(ocrService, 'readCoordinates').mockImplementation(async () => {
      events.push('ocrRead');
      return options.coord ?? 'X:111 Y:222';
    });
    const state: any = {
      step: 1, dirIndex: 0, moveCount: 0, dirSwipes: 0, checkedCenter: false,
      centerX: 800, centerY: 450, halfW: 500, halfH: 300, maxAttempts: 0,
    };
    return { ctx, state, events };
  }

  afterEach(() => jest.restoreAllMocks());

  it('verify 失败后不执行 caiji、OCR 或 verified 点击', async () => {
    const { ctx, state, events } = setup({ verify: [] });
    await expect(searchAndClickGem(ctx, config, state, ['111222'])).resolves.toEqual({ found: false });
    expect(events).toContain('verify');
    expect(events).not.toContain('caiji');
    expect(events).not.toContain('ocr');
    expect(events).not.toContain('verifiedTap');
  });

  it('caiji 命中后不执行 OCR、verified 点击或采集按钮', async () => {
    const { ctx, state, events } = setup({ caiji: [{ x: 10, y: 10, confidence: 0.9, classIndex: 1 }] });
    await expect(searchAndClickGem(ctx, config, state, ['111222'])).resolves.toEqual({ found: false });
    expect(events).toContain('caiji');
    expect(events).not.toContain('ocr');
    expect(events).not.toContain('verifiedTap');
    expect(ctx.findImageWithLocation.mock.calls.some((call: any[]) => String(call[0]).endsWith('btn_caiji.png'))).toBe(false);
  });

  it('OCR 判为重复后不点击 verified 坐标', async () => {
    const { ctx, state, events } = setup({ coord: 'X:111 Y:222' });
    await expect(searchAndClickGem(ctx, config, state, ['111222'])).resolves.toEqual({ found: false });
    expect(events).toContain('ocrRead');
    expect(events).not.toContain('verifiedTap');
  });

  it('成功路径依次 verify、caiji、OCR、verified 点击、采集按钮', async () => {
    const { ctx, state, events } = setup({ coord: 'X:333 Y:444' });
    await expect(searchAndClickGem(ctx, config, state, ['111222'])).resolves.toEqual({ found: true, x: 700, y: 400 });
    expect(events).toEqual(expect.arrayContaining(['verify', 'caiji', 'ocrRead', 'verifiedTap', 'buttonTap']));
    expect(events.indexOf('verify')).toBeLessThan(events.indexOf('caiji'));
    expect(events.indexOf('caiji')).toBeLessThan(events.indexOf('ocrRead'));
    expect(events.indexOf('ocrRead')).toBeLessThan(events.indexOf('verifiedTap'));
    expect(events.indexOf('verifiedTap')).toBeLessThan(events.indexOf('buttonTap'));
    expect(ctx.tap).toHaveBeenCalledWith(700, 400);
    expect(ctx.tap).toHaveBeenCalledWith(675, 335);
  });

  it('采集按钮缺失时缩地并在搜索耗尽后安全退出', async () => {
    const { ctx, state } = setup({ coord: 'X:333 Y:444', buttonFound: false });
    await expect(searchAndClickGem(ctx, config, state, ['111222'])).resolves.toEqual({ found: false });
    expect(ctx.findImageWithLocation).toHaveBeenCalled();
    expect(ctx.swipeAndHold).toHaveBeenCalled();
  });
});
