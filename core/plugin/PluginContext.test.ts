import { PluginContext } from './PluginContext';
import { Device } from '../device';
import { Vision } from '../vision';
import sharp from 'sharp';
import * as fs from 'fs/promises';

describe('PluginContext', () => {
  let mockDevice: jest.Mocked<Device>;
  let mockVision: jest.Mocked<Vision>;
  let context: PluginContext;

  beforeEach(() => {
    mockDevice = {
      tap: jest.fn(),
      swipe: jest.fn(),
      inputText: jest.fn(),
      sleep: jest.fn(),
      screenshot: jest.fn().mockResolvedValue(Buffer.from('fake'))
    } as any;

    mockVision = {
      findImage: jest.fn()
    } as any;

    context = new PluginContext(mockDevice, mockVision, { testKey: 'testValue' });
  });

  it('should call device tap', async () => {
    await context.tap(100, 200);
    expect(mockDevice.tap).toHaveBeenCalledWith(100, 200);
  });

  it('should call device swipe', async () => {
    await context.swipe(0, 0, 100, 100, 300);
    // 默认值也会转发下去：useBezier / singleShot
    expect(mockDevice.swipe).toHaveBeenCalledWith(0, 0, 100, 100, 300, false, false);
  });

  it('should forward swipe options', async () => {
    await context.swipe(0, 0, 100, 100, 300, true, true);
    expect(mockDevice.swipe).toHaveBeenCalledWith(0, 0, 100, 100, 300, true, true);
  });

  it('should call device inputText', async () => {
    await context.inputText('hello');
    expect(mockDevice.inputText).toHaveBeenCalledWith('hello');
  });

  it('should get config value', () => {
    expect(context.getConfig('testKey')).toBe('testValue');
    expect(context.getConfig('nonExistent', 'default')).toBe('default');
  });

  it('should log message with prefix', () => {
    const consoleSpy = jest.spyOn(console, 'log').mockImplementation();
    context.log('test message');
    expect(consoleSpy).toHaveBeenCalledWith('[PluginContext] test message');
    consoleSpy.mockRestore();
  });
});

describe('PluginContext.captureRegion', () => {
  let mockDevice: jest.Mocked<Device>;
  let context: PluginContext;

  /** 造一张指定尺寸的真 PNG，让 sharp 走真实解码路径 */
  async function screenOf(width: number, height: number): Promise<Buffer> {
    return sharp({
      create: { width, height, channels: 3, background: { r: 20, g: 40, b: 60 } },
    }).png().toBuffer();
  }

  beforeEach(() => {
    mockDevice = { screenshot: jest.fn() } as any;
    context = new PluginContext(mockDevice, {} as any, {});
  });

  it('should crop a region that fits inside the screenshot', async () => {
    mockDevice.screenshot.mockResolvedValue(await screenOf(1600, 900));

    const regionPath = await context.captureRegion(1475, 12, 80, 37);

    try {
      const meta = await sharp(regionPath).metadata();
      expect(meta.width).toBe(80);
      expect(meta.height).toBe(37);
    } finally {
      await fs.unlink(regionPath).catch(() => {});
    }
  });

  it('should report actual and requested geometry when the region is out of bounds', async () => {
    // 1280×720 的模拟器上，宝石数量区域 (1475,12,80,37) 会越过右边界
    mockDevice.screenshot.mockResolvedValue(await screenOf(1280, 720));

    await expect(context.captureRegion(1475, 12, 80, 37)).rejects.toThrow(
      /截图尺寸 1280×720.*请求区域 \(1475,12\) 80×37/s
    );
  });
});
