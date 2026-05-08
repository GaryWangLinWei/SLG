import { PluginContext } from './PluginContext';
import { Device } from '../device';
import { Vision } from '../vision';

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
    expect(mockDevice.swipe).toHaveBeenCalledWith(0, 0, 100, 100, 300);
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
