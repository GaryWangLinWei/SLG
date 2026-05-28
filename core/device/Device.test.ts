import { Device } from './Device';
import { AdbDevice, RandomizationConfig } from './AdbDevice';

describe('Device Interface', () => {
  it('should be implemented by AdbDevice', () => {
    const device: Device = new AdbDevice('test-device');
    expect(typeof device.connect).toBe('function');
    expect(typeof device.disconnect).toBe('function');
    expect(typeof device.screenshot).toBe('function');
    expect(typeof device.tap).toBe('function');
    expect(typeof device.swipe).toBe('function');
    expect(typeof device.inputText).toBe('function');
    expect(typeof device.sleep).toBe('function');
  });
});

describe('AdbDevice Randomization', () => {
  let device: AdbDevice;

  beforeEach(() => {
    device = new AdbDevice('emulator-5554');
    (device as any).connected = true;
    const mockExec = jest.fn().mockResolvedValue({ stdout: '' });
    (device as any).execAsync = mockExec;
  });

  it('should jitter tap coordinates when enabled', async () => {
    device.setRandomizationConfig({ tapOffset: 10, sleepJitter: 0 });
    const execSpy = jest.spyOn(device as any, 'execAdb');

    // Tap many times and check coordinates vary
    const coords: string[] = [];
    for (let i = 0; i < 10; i++) {
      await device.tap(100, 200);
      const call = execSpy.mock.calls[execSpy.mock.calls.length - 1][0] as string;
      // Extract x y from "shell input tap X Y" or "shell input swipe X Y X Y dur"
      const match = call.match(/(?:tap|swipe)\s+(\d+)\s+(\d+)/);
      coords.push(match ? `${match[1]},${match[2]}` : '');
    }
    // Should not all be the same
    const unique = new Set(coords);
    expect(unique.size).toBeGreaterThan(1);
  });

  it('should not use coordinate jitter when disabled', async () => {
    device.setRandomizationEnabled(false);
    // Mock Math.random to verify no jitter
    const randomSpy = jest.spyOn(Math, 'random');
    await device.tap(100, 200);
    // Math.random should not be called when randomization is disabled
    expect(randomSpy).not.toHaveBeenCalled();
    randomSpy.mockRestore();
  });

  it('should only add time in sleep (no reduction)', async () => {
    device.setRandomizationConfig({ sleepJitter: 1.0 }); // up to 100% add
    const start = Date.now();
    await device.sleep(0.05); // 50ms base
    const elapsed = Date.now() - start;
    expect(elapsed).toBeGreaterThanOrEqual(48); // allow small timer variance
  });

  it('should set config partially', () => {
    device.setRandomizationConfig({ tapOffset: 15 });
    const config = (device as any).randConfig as RandomizationConfig;
    expect(config.tapOffset).toBe(15);
    expect(config.enabled).toBe(true); // unchanged
    expect(config.sleepJitter).toBe(0.15); // unchanged
  });

  it('should set enabled flag', () => {
    device.setRandomizationEnabled(false);
    expect((device as any).randConfig.enabled).toBe(false);
    device.setRandomizationEnabled(true);
    expect((device as any).randConfig.enabled).toBe(true);
  });

  it('should use swipe for tap when randomization enabled', async () => {
    device.setRandomizationEnabled(true);
    const execSpy = jest.spyOn(device as any, 'execAdb');
    await device.tap(100, 200);
    const cmd = execSpy.mock.calls[0][0] as string;
    expect(cmd).toContain('swipe');
    expect(cmd).not.toContain('tap');
    execSpy.mockRestore();
  });

  it('should use tap command when randomization disabled', async () => {
    device.setRandomizationEnabled(false);
    const execSpy = jest.spyOn(device as any, 'execAdb');
    await device.tap(100, 200);
    const cmd = execSpy.mock.calls[0][0] as string;
    expect(cmd).toContain('tap');
    expect(cmd).not.toContain('swipe');
    execSpy.mockRestore();
  });

  it('should sleep within range when maxSeconds is provided', async () => {
    device.setRandomizationConfig({ sleepJitter: 0 });
    const start = Date.now();
    await device.sleep(0.1, 0.3); // 100-300ms
    const elapsed = Date.now() - start;
    expect(elapsed).toBeGreaterThanOrEqual(95);
    expect(elapsed).toBeLessThan(500); // generous upper bound for CI
  });

  it('should sleep at least min when maxSeconds is provided', async () => {
    device.setRandomizationConfig({ sleepJitter: 0 });
    const start = Date.now();
    await device.sleep(0.05, 0.2); // expect at least 50ms
    const elapsed = Date.now() - start;
    expect(elapsed).toBeGreaterThanOrEqual(48);
  });
});
