import { EventEmitter } from 'events';
import { spawn } from 'child_process';
import { AdbDevice } from './AdbDevice';
import * as fs from 'fs';
import * as path from 'path';

jest.mock('child_process', () => ({
  ...(jest.requireActual('child_process') as object),
  spawn: jest.fn(),
}));

/**
 * 伪造一个 spawn 出来的子进程：推一段 stdout 后以给定 code 退出。
 * 必须在 spawn 被调用的那一刻构造（用 mockImplementation 而非 mockReturnValue），
 * 否则 nextTick 会在调用方挂上监听器之前就把事件发空。
 */
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

/** 让 spawn 依次返回这些 stdout 内容；最后一个会被后续调用重复使用 */
function mockScreencapOutputs(...outputs: Buffer[]) {
  let i = 0;
  (spawn as jest.Mock).mockImplementation(() =>
    fakeChild(outputs[Math.min(i++, outputs.length - 1)])
  );
}

const PNG_SIG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
/** 合法 PNG（只需签名正确，screenshot() 不解码像素） */
const validPng = Buffer.concat([PNG_SIG, Buffer.from('IHDR...pixels')]);
/** 被 CRLF 翻译污染的同一张图：每个 0x0A 都变成了 0x0D 0x0A */
const crlfMangledPng = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0d, 0x0a, 0x1a, 0x0d, 0x0a]),
  Buffer.from('IHDR...pixels'),
]);

describe('AdbDevice Screenshot', () => {
  let device: AdbDevice;

  beforeEach(() => {
    jest.resetAllMocks();
    device = new AdbDevice('test-device-id');
    // 损坏截图重试不需要真的等
    (device as any).corruptRetryDelayMs = 0;
  });

  it('should return Buffer from screenshot', async () => {
    (device as any).connected = true;
    // 无 savePath 时走 spawn + exec-out screencap，直接读原始二进制
    mockScreencapOutputs(validPng);

    const result = await device.screenshot();

    expect(Buffer.isBuffer(result)).toBe(true);
    expect(result.equals(validPng)).toBe(true);
    const [, args] = (spawn as jest.Mock).mock.calls[0];
    expect(args).toEqual(['-s', 'test-device-id', 'exec-out', 'screencap', '-p']);
  });

  it('should retry when screencap exits 0 but returns an empty buffer', async () => {
    (device as any).connected = true;
    mockScreencapOutputs(Buffer.alloc(0), validPng);

    const result = await device.screenshot();

    expect(result.equals(validPng)).toBe(true);
    expect((spawn as jest.Mock)).toHaveBeenCalledTimes(2);
  });

  it('should retry when screencap returns a non-PNG buffer', async () => {
    (device as any).connected = true;
    mockScreencapOutputs(Buffer.from('error: closed'), validPng);

    const result = await device.screenshot();

    expect(result.equals(validPng)).toBe(true);
    expect((spawn as jest.Mock)).toHaveBeenCalledTimes(2);
  });

  it('should recover a CRLF-mangled PNG without respawning', async () => {
    (device as any).connected = true;
    mockScreencapOutputs(crlfMangledPng);

    const result = await device.screenshot();

    expect(result.equals(validPng)).toBe(true);
    expect((spawn as jest.Mock)).toHaveBeenCalledTimes(1);
  });

  it('should throw a corrupt-screenshot error when every attempt is unusable', async () => {
    (device as any).connected = true;
    mockScreencapOutputs(Buffer.from('not a png'));

    await expect(device.screenshot()).rejects.toThrow('截图内容非法');
  });

  it('should not mark the device disconnected after corrupt screenshots', async () => {
    (device as any).connected = true;
    mockScreencapOutputs(Buffer.from('not a png'));

    await expect(device.screenshot()).rejects.toThrow();
    expect((device as any).connected).toBe(true);
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
