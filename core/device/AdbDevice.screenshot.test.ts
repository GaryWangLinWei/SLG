import { AdbDevice } from './AdbDevice';
import * as fs from 'fs';
import * as path from 'path';

describe('AdbDevice Screenshot', () => {
  let device: AdbDevice;

  beforeEach(() => {
    device = new AdbDevice('test-device-id');
  });

  it('should return Buffer from screenshot', async () => {
    (device as any).connected = true;

    const mockExec = jest.fn().mockResolvedValue({ stdout: Buffer.from('fake-screenshot-data') });
    (device as any).execAsync = mockExec;

    const result = await device.screenshot();
    expect(Buffer.isBuffer(result)).toBe(true);
  });

  it('should throw error when device not connected', async () => {
    await expect(device.screenshot()).rejects.toThrow('Device not connected');
  });

  it('should save to file when savePath is provided', async () => {
    (device as any).connected = true;

    const mockExec = jest.fn().mockResolvedValue({ stdout: Buffer.from('') });
    (device as any).execAsync = mockExec;

    jest.spyOn(fs.promises, 'readFile').mockResolvedValue(Buffer.from('saved-screenshot-data'));

    const savePath = path.join(__dirname, 'test-screenshot.png');
    const result = await device.screenshot(savePath);

    expect(mockExec).toHaveBeenCalledWith(expect.stringContaining('screencap'));
    expect(mockExec).toHaveBeenCalledWith(expect.stringContaining('pull'));
    expect(fs.promises.readFile).toHaveBeenCalledWith(savePath);
    expect(result.toString()).toBe('saved-screenshot-data');
  });
});
