import { Vision } from '../../../core/vision';
import { buildGemOccupiedDebugOverlaySvg, createSpiralState, isGemOccupied, nextGemSearchPauseSeconds } from './gatherGem';

jest.mock('fs/promises', () => ({
  unlink: jest.fn(async () => {}),
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

describe('gatherGem 点击前占用检测调试截图', () => {
  it('用红框标注最高置信度匹配区域和置信度', () => {
    const svg = buildGemOccupiedDebugOverlaySvg(60, 90, {
      found: true,
      confidence: 0.934,
      rect: { x: 18, y: 25, width: 32, height: 28 },
    });

    expect(svg).toContain('stroke="red"');
    expect(svg).toContain('x="18"');
    expect(svg).toContain('y="25"');
    expect(svg).toContain('width="32"');
    expect(svg).toContain('height="28"');
    expect(svg).toContain('93.4%');
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
      log: jest.fn(),
    };

    const occupied = await isGemOccupied(ctx, 800, 450);

    expect(occupied).toBe(false);
    expect(ctx.captureRegion).toHaveBeenCalledWith(760, 340, 80, 110);
    expect(findImage.mock.calls.map(call => call[1].replace(/\\/g, '/')))
      .toContainEqual(expect.stringContaining('/state_caiji.png'));
    expect(ctx.detectImage).not.toHaveBeenCalled();

    findImage.mockRestore();
  });
});
