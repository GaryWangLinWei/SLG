import { detectTeamStates, detectStatusRegionTeamStates } from '../utils/teamStateDetection';

function makeCtx(dets: any[]) {
  return {
    log: jest.fn(),
    detectStateWithScreenshot: jest.fn(async () => dets),
  } as any;
}

describe('gatherGemFocus 状态检测（state.onnx）', () => {
  it('全屏 state.onnx 检测 + STATUS_REGION 过滤，映射状态', async () => {
    const ctx = makeCtx([
      { x: 1556, y: 300, width: 40, height: 24, confidence: 0.9, classIndex: 0 }, // 返回，STATUS_REGION 内
      { x: 1556, y: 500, width: 40, height: 24, confidence: 0.8, classIndex: 3 }, // 驻扎，STATUS_REGION 内
      { x: 800, y: 400, width: 40, height: 24, confidence: 0.9, classIndex: 0 }, // 区域外，过滤掉
    ]);

    const results = await detectStatusRegionTeamStates(ctx, ['back', 'zhuzha']);

    expect(ctx.detectStateWithScreenshot).toHaveBeenCalledWith(0.35, [0, 3]);
    expect(results.map((r: any) => r.state)).toEqual(['back', 'zhuzha']);
    expect(results[0]).toMatchObject({ state: 'back', x: 1556, y: 300 });
  });

  it('detectTeamStates 走全屏检测，坐标不做偏移', async () => {
    const ctx = makeCtx([
      { x: 1500, y: 200, width: 40, height: 24, confidence: 0.9, classIndex: 3 },
    ]);
    const results = await detectTeamStates(ctx, ['zhuzha']);
    expect(results).toEqual([{ state: 'zhuzha', x: 1500, y: 200, confidence: 0.9 }]);
  });

  it('按类别卡置信度：全部状态统一 >= 0.4', async () => {
    const ctx = makeCtx([
      { x: 1556, y: 200, width: 40, height: 24, confidence: 0.44, classIndex: 3 }, // 驻扎 0.44 → 保留
      { x: 1556, y: 400, width: 40, height: 24, confidence: 0.35, classIndex: 1 }, // 采集 0.35 → 剔除
      { x: 1556, y: 600, width: 40, height: 24, confidence: 0.66, classIndex: 1 }, // 采集 0.66 → 保留
    ]);

    const results = await detectTeamStates(ctx, ['zhuzha', 'caiji']);

    expect(results.map((r: any) => `${r.state}:${r.confidence}`)).toEqual([
      'zhuzha:0.44', 'caiji:0.66',
    ]);
  });
});
