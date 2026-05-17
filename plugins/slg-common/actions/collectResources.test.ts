import { collectResources } from './collectResources';
import { PluginContext } from '../../../core/plugin/PluginContext';
import { ResourceConfig } from '../types';

describe('collectResources', () => {
  let mockCtx: jest.Mocked<PluginContext>;
  let testResources: ResourceConfig[];

  beforeEach(() => {
    jest.clearAllMocks();
    mockCtx = {
      log: jest.fn(),
      tap: jest.fn(),
      tapImage: jest.fn(),
      sleep: jest.fn(),
      waitForImage: jest.fn().mockResolvedValue(true)
    } as any;

    testResources = [
      { name: '金矿', collectButton: { x: 100, y: 200 } },
      { name: '农田', collectButton: { x: 150, y: 250 } }
    ];
  });

  it('should collect all resources by position', async () => {
    await collectResources(mockCtx, testResources);

    expect(mockCtx.log).toHaveBeenCalledWith('开始收集资源...');
    expect(mockCtx.log).toHaveBeenCalledWith('收集 金矿...');
    expect(mockCtx.log).toHaveBeenCalledWith('收集 农田...');
    expect(mockCtx.tap).toHaveBeenCalledTimes(2);
    expect(mockCtx.tap).toHaveBeenCalledWith(100, 200);
    expect(mockCtx.tap).toHaveBeenCalledWith(150, 250);
    expect(mockCtx.sleep).toHaveBeenCalledTimes(4); // 2 resources * (1 + 0.5)
  });

  it('should use template image if provided', async () => {
    testResources[0].templateImage = 'gold-mine.png';
    await collectResources(mockCtx, testResources);

    expect(mockCtx.waitForImage).toHaveBeenCalledWith('gold-mine.png', 5);
    expect(mockCtx.tapImage).toHaveBeenCalledWith('gold-mine.png');
  });

  it('should skip resource if template not found', async () => {
    mockCtx.waitForImage.mockResolvedValue(false);
    testResources[0].templateImage = 'gold-mine.png';

    await collectResources(mockCtx, testResources);

    expect(mockCtx.log).toHaveBeenCalledWith('未找到 金矿，跳过');
    expect(mockCtx.tapImage).not.toHaveBeenCalled();
  });
});
