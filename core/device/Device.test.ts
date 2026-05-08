import { Device } from './Device';

describe('Device Interface', () => {
  it('should have connect method', () => {
    const device: Device = {} as Device;
    expect(typeof device.connect).toBe('function');
  });

  it('should have disconnect method', () => {
    const device: Device = {} as Device;
    expect(typeof device.disconnect).toBe('function');
  });

  it('should have screenshot method', () => {
    const device: Device = {} as Device;
    expect(typeof device.screenshot).toBe('function');
  });
});
