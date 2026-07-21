import { detectTeamStates } from './teamStateDetection';

const det = (x: number, y: number, confidence: number, classIndex: number) =>
  ({ x, y, width: 10, height: 10, confidence, classIndex });

describe('teamStateDetection', () => {
  beforeEach(() => jest.clearAllMocks());

  it('全屏推理并过滤类别/置信度、映射状态、按 y 排序', async () => {
    const ctx: any = {
      log: jest.fn(),
      detectStateWithScreenshot: jest.fn(async () => [
        det(720, 370, 0.8, 3),
        det(710, 310, 0.39, 1),
        det(730, 320, 0.9, 1),
        det(740, 330, 0.9, 0),
      ]),
    };
    const result = await detectTeamStates(ctx, ['caiji', 'zhuzha']);
    expect(ctx.detectStateWithScreenshot).toHaveBeenCalledWith(0.35, [1, 3]);
    expect(result).toEqual([
      { state: 'caiji', x: 730, y: 320, confidence: 0.9 },
      { state: 'zhuzha', x: 720, y: 370, confidence: 0.8 },
    ]);
  });

  it('默认参数请求全部四个类别', async () => {
    const ctx: any = {
      log: jest.fn(),
      detectStateWithScreenshot: jest.fn(async () => [det(500, 200, 0.9, 0)]),
    };
    await expect(detectTeamStates(ctx)).resolves.toEqual([
      { state: 'back', x: 500, y: 200, confidence: 0.9 },
    ]);
    expect(ctx.detectStateWithScreenshot).toHaveBeenCalledWith(0.35, [3, 1, 0, 2]);
  });
});
