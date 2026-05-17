import { upgradeBuildings } from './upgradeBuildings';
import { PluginContext } from '../../../core/plugin/PluginContext';
import { BuildingConfig } from '../types';

describe('upgradeBuildings', () => {
  let mockCtx: jest.Mocked<PluginContext>;
  let testBuildings: BuildingConfig[];

  beforeEach(() => {
    jest.clearAllMocks();
    mockCtx = {
      log: jest.fn(),
      tap: jest.fn(),
      sleep: jest.fn(),
      getConfig: jest.fn((key) => {
        if (key === 'upgradeButtonPosition') return { x: 500, y: 800 };
        if (key === 'backButtonPosition') return { x: 50, y: 50 };
        return undefined;
      })
    } as any;

    testBuildings = [
      { name: '兵营', position: { x: 300, y: 400 }, upgradePriority: 5 },
      { name: '市政厅', position: { x: 200, y: 300 }, upgradePriority: 10 }
    ];
  });

  it('should upgrade buildings by priority order (highest first)', async () => {
    await upgradeBuildings(mockCtx, testBuildings);

    expect(mockCtx.log).toHaveBeenCalledWith('开始检查建筑升级...');

    // Verify order: 市政厅 (priority 10) should be checked before 兵营 (priority 5)
    const callOrder = mockCtx.log.mock.calls.map(call => call[0]);
    const cityHallIndex = callOrder.findIndex(s => s.includes('市政厅'));
    const barracksIndex = callOrder.findIndex(s => s.includes('兵营'));
    expect(cityHallIndex).toBeLessThan(barracksIndex);

    // Verify taps: building tap + upgrade button tap + back button tap for each building
    expect(mockCtx.tap).toHaveBeenCalledTimes(6); // 2 buildings * 3 taps each
    expect(mockCtx.log).toHaveBeenCalledWith('尝试升级 市政厅');
    expect(mockCtx.log).toHaveBeenCalledWith('尝试升级 兵营');
    expect(mockCtx.log).toHaveBeenCalledWith('建筑升级检查完成');
  });

  it('should not tap upgrade/back buttons if positions not configured', async () => {
    (mockCtx.getConfig as jest.Mock).mockReturnValue(undefined);

    await upgradeBuildings(mockCtx, testBuildings);

    // Only building position tap for each building
    expect(mockCtx.tap).toHaveBeenCalledTimes(2);
  });
});
