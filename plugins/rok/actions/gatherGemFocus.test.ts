import { detectTeamStates, detectStatusRegionTeamStates } from './gatherGemFocus';

jest.mock('fs/promises', () => ({
  unlink: jest.fn(async () => {}),
  mkdir: jest.fn(async () => {}),
}));

// 测试环境下 isDevEnv() 为 true，会调用 sharp 存调试图；mock 掉避免依赖真实文件
jest.mock('sharp', () => {
  const chain: any = {
    metadata: jest.fn(async () => ({ width: 1600, height: 900 })),
    composite: jest.fn(() => chain),
    toFile: jest.fn(async () => {}),
  };
  return jest.fn(() => chain);
});

function makeCtx(dets: any[]) {
  return {
    log: jest.fn(),
    captureRegion: jest.fn(async () => 'temp-shot.png'),
    detectStateImage: jest.fn(async () => dets),
  } as any;
}

describe('gatherGemFocus 状态检测（state.onnx）', () => {
  it('截全屏用 state.onnx 检测，按类别索引映射状态，不再拖动面板', async () => {
    const ctx = makeCtx([
      { x: 1556, y: 300, width: 40, height: 24, confidence: 0.9, classIndex: 0 }, // 返回
      { x: 1556, y: 500, width: 40, height: 24, confidence: 0.8, classIndex: 3 }, // 驻扎
    ]);

    const results = await detectStatusRegionTeamStates(ctx, ['back', 'zhuzha']);

    // 检测时跑全部 4 类（调试图能标注所有识别到的类），功能过滤在结果里做
    expect(ctx.detectStateImage).toHaveBeenCalledWith('temp-shot.png', 0.35, [0, 1, 2, 3]);
    expect(ctx.swipeAndHold).toBeUndefined();
    expect(results.map((r: any) => r.state)).toEqual(['back', 'zhuzha']);
    expect(results[0]).toMatchObject({ state: 'back', x: 1556, y: 300 });
  });

  it('region 过滤：命中框中心落在区域外的被剔除', async () => {
    const ctx = makeCtx([
      { x: 1500, y: 200, width: 40, height: 24, confidence: 0.9, classIndex: 3 }, // 区域内
      { x: 100, y: 200, width: 40, height: 24, confidence: 0.9, classIndex: 3 },  // 区域外
    ]);

    const region = { x: 1443, y: 53, w: 152, h: 753 };
    const results = await detectTeamStates(ctx, ['zhuzha'], region);

    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({ state: 'zhuzha', x: 1500 });
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
