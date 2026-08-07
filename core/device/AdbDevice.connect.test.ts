import { AdbDevice } from './AdbDevice';

const DEVICES_EMPTY = 'List of devices attached\n\n';
const DEVICES_WITH_DEVICE = 'List of devices attached\n127.0.0.1:7555\tdevice\n';

// 命令形如 "<adbpath> devices" / "<adbpath> connect host:port"
// adb 路径可能是 .../adb.exe，所以用 adb[^\s]* 匹配 adb 或 adb.exe
const RE_CONNECT = /adb[^\s]*\s+connect/;
const RE_DEVICES = /adb[^\s]*\s+devices/;
const RE_KILL = /adb[^\s]*\s+kill-server/;
const RE_START = /adb[^\s]*\s+start-server/;

describe('AdbDevice.connect ADB reset retry', () => {
  it('首次 adb devices 找不到设备时，kill-server/start-server 后重连成功', async () => {
    const device = new AdbDevice('127.0.0.1:7555');
    const calls: string[] = [];
    let devicesCalls = 0;
    (device as any).execAsync = jest.fn(async (cmd: string) => {
      calls.push(cmd);
      if (RE_KILL.test(cmd)) return { stdout: '', stderr: '' };
      if (RE_START.test(cmd)) return { stdout: 'daemon started successfully\n', stderr: '' };
      if (RE_CONNECT.test(cmd)) return { stdout: 'connected to 127.0.0.1:7555\n', stderr: '' };
      if (RE_DEVICES.test(cmd)) {
        devicesCalls++;
        return { stdout: devicesCalls >= 2 ? DEVICES_WITH_DEVICE : DEVICES_EMPTY, stderr: '' };
      }
      return { stdout: '', stderr: '' };
    });

    const ok = await device.connect();

    expect(ok).toBe(true);
    expect(device.isConnected()).toBe(true);
    // 必须执行了 kill-server 与 start-server
    expect(calls.some(c => RE_KILL.test(c))).toBe(true);
    expect(calls.some(c => RE_START.test(c))).toBe(true);
    // 第二次 connect 发生在 start-server 之后
    const firstConnectIdx = calls.findIndex(c => RE_CONNECT.test(c));
    const startIdx = calls.findIndex(c => RE_START.test(c));
    const connectCallsAfterStart = calls.slice(startIdx).filter(c => RE_CONNECT.test(c)).length;
    expect(firstConnectIdx).toBeGreaterThanOrEqual(0);
    expect(startIdx).toBeGreaterThan(firstConnectIdx);
    expect(connectCallsAfterStart).toBeGreaterThanOrEqual(1);
  });

  it('设备已正常在线时不重置 adb server，直接连接成功', async () => {
    const device = new AdbDevice('127.0.0.1:7555');
    const calls: string[] = [];
    (device as any).execAsync = jest.fn(async (cmd: string) => {
      calls.push(cmd);
      if (RE_CONNECT.test(cmd)) return { stdout: 'connected to 127.0.0.1:7555\n', stderr: '' };
      if (RE_DEVICES.test(cmd)) return { stdout: DEVICES_WITH_DEVICE, stderr: '' };
      return { stdout: '', stderr: '' };
    });

    const ok = await device.connect();

    expect(ok).toBe(true);
    expect(calls.some(c => RE_KILL.test(c))).toBe(false);
    expect(calls.some(c => RE_START.test(c))).toBe(false);
  });

  it('重置后仍找不到设备时返回 false（不抛异常）', async () => {
    const device = new AdbDevice('127.0.0.1:7555');
    const calls: string[] = [];
    (device as any).execAsync = jest.fn(async (cmd: string) => {
      calls.push(cmd);
      if (RE_CONNECT.test(cmd)) return { stdout: 'failed to connect to 127.0.0.1:7555: cannot connect\n', stderr: '' };
      if (RE_DEVICES.test(cmd)) return { stdout: DEVICES_EMPTY, stderr: '' };
      return { stdout: '', stderr: '' };
    });

    const ok = await device.connect();

    expect(ok).toBe(false);
    expect(device.isConnected()).toBe(false);
    expect(calls.some(c => RE_KILL.test(c))).toBe(true);
    expect(calls.some(c => RE_START.test(c))).toBe(true);
  });
});
