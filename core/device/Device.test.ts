import { Device } from './Device';
import { AdbDevice } from './AdbDevice';

describe('Device Interface', () => {
  it('should be implemented by AdbDevice', () => {
    const device: Device = new AdbDevice();
    expect(typeof device.connect).toBe('function');
    expect(typeof device.disconnect).toBe('function');
    expect(typeof device.screenshot).toBe('function');
    expect(typeof device.tap).toBe('function');
    expect(typeof device.swipe).toBe('function');
    expect(typeof device.inputText).toBe('function');
    expect(typeof device.sleep).toBe('function');
  });
});
