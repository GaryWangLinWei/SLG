import { runLoop, LoopConfig } from './loop';
import { PluginContext } from '../../../core/plugin';

describe('runLoop', () => {
  let mockCtx: jest.Mocked<PluginContext>;
  let mockAction: jest.Mock;

  beforeEach(() => {
    jest.clearAllMocks();
    mockCtx = {
      log: jest.fn(),
      sleep: jest.fn().mockResolvedValue(undefined)
    } as any;
    mockAction = jest.fn().mockResolvedValue(undefined);
  });

  it('should run action specified number of times', async () => {
    const config: LoopConfig = {
      action: mockAction,
      intervalSeconds: 1,
      maxIterations: 3
    };

    await runLoop(mockCtx, config);

    expect(mockAction).toHaveBeenCalledTimes(3);
    expect(mockCtx.sleep).toHaveBeenCalledTimes(2); // Only sleep between iterations
  });

  it('should stop on error when stopOnError is true', async () => {
    const error = new Error('Test error');
    mockAction.mockRejectedValue(error);

    const config: LoopConfig = {
      action: mockAction,
      intervalSeconds: 1,
      maxIterations: 3,
      stopOnError: true
    };

    await expect(runLoop(mockCtx, config)).rejects.toThrow('Test error');
    expect(mockAction).toHaveBeenCalledTimes(1);
  });

  it('should continue on error when stopOnError is false', async () => {
    const error = new Error('Test error');
    mockAction.mockRejectedValue(error);

    const config: LoopConfig = {
      action: mockAction,
      intervalSeconds: 1,
      maxIterations: 3,
      stopOnError: false
    };

    await runLoop(mockCtx, config);

    expect(mockAction).toHaveBeenCalledTimes(3);
    expect(mockCtx.log).toHaveBeenCalledWith(expect.stringContaining('执行出错'));
  });

  it('should log iteration number', async () => {
    const config: LoopConfig = {
      action: mockAction,
      intervalSeconds: 1,
      maxIterations: 2
    };

    await runLoop(mockCtx, config);

    expect(mockCtx.log).toHaveBeenCalledWith('--- 第 1 次执行 ---');
    expect(mockCtx.log).toHaveBeenCalledWith('--- 第 2 次执行 ---');
  });
});
