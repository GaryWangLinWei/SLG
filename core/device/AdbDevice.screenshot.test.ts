import { EventEmitter } from 'events';
import { spawn } from 'child_process';
import { AdbDevice } from './AdbDevice';
import * as fs from 'fs';
import * as path from 'path';

jest.mock('child_process', () => ({
  ...(jest.requireActual('child_process') as object),
  spawn: jest.fn(),
}));

/** 伪造一个 spawn 出来的子进程：推一段 stdout 后以给定 code 退出 */
function fakeChild(stdout: Buffer, code = 0) {
  const child: any = new EventEmitter();
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  process.nextTick(() => {
    child.stdout.emit('data', stdout);
    child.emit('close', code);
  });
  return child;
}

describe('AdbDevice Screenshot', () => {
  let device: AdbDevice;

  beforeEach(() => {
    jest.clearAllMocks();
    device = new AdbDevice('test-device-id');
  });

  it('should return Buffer from screenshot', async () => {
    (device as any).connected = true;
    // 无 savePath 时走 spawn + exec-out screencap，直接读原始二进制
    (spawn as jest.Mock).mockReturnValue(fakeChild(Buffer.from('fake-screenshot-data')));

    const result = await device.screenshot();

    expect(Buffer.isBuffer(result)).toBe(true);
    expect(result.toString()).toBe('fake-screenshot-data');
    const [, args] = (spawn as jest.Mock).mock.calls[0];
    expect(args).toEqual(['-s', 'test-device-id', 'exec-out', 'screencap', '-p']);
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
