import { Vision } from '../../../core/vision/Vision';
import { searchAndClickGem, selectGemCandidateWithUiAvoidance, SpiralState, verifyGemAtCenter } from './gatherGem';

jest.mock('../utils/teamStateDetection', () => ({
  detectTeamStates: jest.fn().mockResolvedValue([]),
}));

type Detection = {
  x: number;
  y: number;
  confidence: number;
};

function createCtx(redetected: Detection[] = []) {
  return {
    log: jest.fn(),
    swipe: jest.fn().mockResolvedValue(undefined),
    sleep: jest.fn().mockResolvedValue(undefined),
    detectWithScreenshot: jest.fn().mockResolvedValue(redetected),
  } as any;
}

describe('selectGemCandidateWithUiAvoidance', () => {
  test('优先返回非 UI 候选，不执行避让或重检', async () => {
    const uiGem: Detection = { x: 1300, y: 300, confidence: 0.9 };
    const visibleGem: Detection = { x: 900, y: 500, confidence: 0.8 };
    const ctx = createCtx();

    const result = await selectGemCandidateWithUiAvoidance(ctx, [uiGem, visibleGem]);

    expect(result).toBe(visibleGem);
    expect(ctx.swipe).not.toHaveBeenCalled();
    expect(ctx.sleep).not.toHaveBeenCalled();
    expect(ctx.detectWithScreenshot).not.toHaveBeenCalled();
  });

  test('空候选返回 undefined，不执行避让', async () => {
    const ctx = createCtx();

    const result = await selectGemCandidateWithUiAvoidance(ctx, []);

    expect(result).toBeUndefined();
    expect(ctx.swipe).not.toHaveBeenCalled();
    expect(ctx.sleep).not.toHaveBeenCalled();
    expect(ctx.detectWithScreenshot).not.toHaveBeenCalled();
  });

  test('全部候选位于 UI 区时避让一次并原地重检', async () => {
    const movedGem: Detection = { x: 1000, y: 500, confidence: 0.85 };
    const ctx = createCtx([movedGem]);
    const detections: Detection[] = [
      { x: 1400, y: 800, confidence: 0.9 },
      { x: 1300, y: 300, confidence: 0.8 },
    ];

    const result = await selectGemCandidateWithUiAvoidance(ctx, detections);

    expect(ctx.swipe).toHaveBeenCalledTimes(1);
    expect(ctx.swipe).toHaveBeenCalledWith(1100, 625, 800, 450, 500, false);
    expect(ctx.sleep).toHaveBeenCalledTimes(1);
    expect(ctx.sleep).toHaveBeenCalledWith(0.8);
    expect(ctx.detectWithScreenshot).toHaveBeenCalledTimes(1);
    expect(ctx.detectWithScreenshot).toHaveBeenCalledWith(0.35);
    expect(ctx.swipe.mock.invocationCallOrder[0]).toBeLessThan(ctx.sleep.mock.invocationCallOrder[0]);
    expect(ctx.sleep.mock.invocationCallOrder[0]).toBeLessThan(ctx.detectWithScreenshot.mock.invocationCallOrder[0]);
    expect(result).toBe(movedGem);
  });

  test('重检后仍全部位于 UI 区则返回 undefined', async () => {
    const ctx = createCtx([
      { x: 100, y: 850, confidence: 0.88 },
      { x: 1450, y: 820, confidence: 0.77 },
    ]);
    const detections: Detection[] = [
      { x: 1400, y: 800, confidence: 0.9 },
      { x: 1300, y: 300, confidence: 0.8 },
    ];

    const result = await selectGemCandidateWithUiAvoidance(ctx, detections);

    expect(result).toBeUndefined();
    expect(ctx.swipe).toHaveBeenCalledTimes(1);
    expect(ctx.sleep).toHaveBeenCalledTimes(1);
    expect(ctx.detectWithScreenshot).toHaveBeenCalledTimes(1);
  });
});

describe('verifyGemAtCenter 模板兜底', () => {
  test('bigGem 未命中时，中心区域模板命中仍确认成功', async () => {
    const ctx = {
      log: jest.fn(),
      detectBigGemWithScreenshot: jest.fn().mockResolvedValue([]),
      findImageWithLocation: jest.fn()
        .mockResolvedValueOnce({ found: true, x: 800, y: 450, confidence: 0.82 }),
    } as any;

    const result = await verifyGemAtCenter(ctx);

    expect(result).toEqual({ found: true, x: 800, y: 450 });
    expect(ctx.findImageWithLocation).toHaveBeenCalledTimes(1);
    expect(ctx.findImageWithLocation).toHaveBeenCalledWith(
      expect.stringContaining('gem_day_center.png'),
      0.7
    );
  });
});

describe('searchAndClickGem UI 避让接线', () => {
  const config = {
    gemGather: { caijiBtnTemplate: 'caiji.png' },
    resourceCollect: { worldSwitchButton: { x: 50, y: 800 } },
  } as any;

  function state(overrides: Partial<SpiralState>): SpiralState {
    return {
      step: 1, dirIndex: 0, moveCount: 0, dirSwipes: 0,
      checkedCenter: false, centerX: 800, centerY: 450,
      halfW: 400, halfH: 225, maxAttempts: 0,
      ...overrides,
    };
  }

  function runtimeCtx(detections: Detection[][]) {
    return {
      log: jest.fn(),
      detectWithScreenshot: jest.fn().mockImplementation(async () => detections.shift() ?? []),
      captureRegion: jest.fn().mockResolvedValue('occupied-check.png'),
      detectHeroWithScreenshot: jest.fn().mockResolvedValue([]),
      swipe: jest.fn().mockResolvedValue(undefined),
      swipeAndHold: jest.fn().mockResolvedValue(undefined),
      releaseHold: jest.fn().mockResolvedValue(undefined),
      sleep: jest.fn().mockResolvedValue(undefined),
      findImageWithLocation: jest.fn().mockResolvedValue({ found: false }),
      tap: jest.fn().mockResolvedValue(undefined),
      tapRect: jest.fn().mockResolvedValue(undefined),
      detectBigGemWithScreenshot: jest.fn().mockResolvedValue([]),
    } as any;
  }

  beforeEach(() => {
    jest.spyOn(Vision.prototype, 'findImage').mockResolvedValue({
      found: false, confidence: 0, location: undefined, rect: undefined,
    } as any);
  });

  afterEach(() => jest.restoreAllMocks());

  test('初始检测跳过首个 UI 候选并点击后续非 UI 候选', async () => {
    const uiGem = { x: 1300, y: 300, confidence: 0.9 };
    const visibleGem = { x: 900, y: 500, confidence: 0.8 };
    const ctx = runtimeCtx([[uiGem, visibleGem]]);

    const result = await searchAndClickGem(ctx, config, state({}), []);

    expect(result).toEqual({ found: false });
    expect(ctx.swipe).not.toHaveBeenCalled();
    expect(ctx.tap).toHaveBeenCalledWith(visibleGem.x, visibleGem.y);
    expect(ctx.detectWithScreenshot).toHaveBeenCalledTimes(1);
  });

  test('螺旋检测全 UI 时避让并立即使用原地重检候选', async () => {
    const blocked = { x: 1400, y: 800, confidence: 0.9 };
    const movedGem = { x: 1000, y: 500, confidence: 0.85 };
    const ctx = runtimeCtx([[blocked], [movedGem]]);
    const spiral = state({ checkedCenter: true, maxAttempts: 1 });

    const result = await searchAndClickGem(ctx, config, spiral, []);

    expect(result).toEqual({ found: false });
    expect(ctx.detectWithScreenshot).toHaveBeenCalledTimes(2);
    expect(ctx.swipe).toHaveBeenCalledTimes(2);
    expect(ctx.swipe).toHaveBeenNthCalledWith(2, 1100, 625, 800, 450, 500, false);
    expect(ctx.tap).toHaveBeenCalledWith(movedGem.x, movedGem.y);
    expect(spiral.moveCount).toBe(1);
  });
});
