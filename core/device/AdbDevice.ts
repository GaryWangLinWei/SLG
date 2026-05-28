import { Device } from './Device';
import { Point } from '../types';
import { exec, spawn } from 'child_process';
import { promisify } from 'util';
import * as fs from 'fs';

// ADB路径配置
let ADB_PATH_OVERRIDE: string | null = null;

export function setAdbPath(path: string) {
  ADB_PATH_OVERRIDE = path;
}

export function getAdbPath(): string {
  return ADB_PATH_OVERRIDE || process.env.ADB_PATH || 'D:/SLG/tools/platform-tools/platform-tools/adb.exe';
}

export const ADB_PATH = getAdbPath();

export interface RandomizationConfig {
  enabled: boolean;
  tapOffset: number;
  sleepJitter: number;  // 0~1, sleep-only-add percentage
}

const DEFAULT_RAND_CONFIG: RandomizationConfig = {
  enabled: true,
  tapOffset: 7,
  sleepJitter: 0.15,
};

export class AdbDevice implements Device {
  private connected: boolean = false;
  private deviceId: string;
  private reconnectAttempts = 0;
  private maxReconnectAttempts = 3; // 最多重连 3 次
  private reconnectDelayMs = 3000; // 重连间隔 3 秒
  private randConfig: RandomizationConfig = { ...DEFAULT_RAND_CONFIG };

  private jitter(n: number): number {
    if (!this.randConfig.enabled) return n;
    return n * (1 + Math.random() * this.randConfig.sleepJitter);
  }

  private jitterCoord(v: number): number {
    if (!this.randConfig.enabled) return v;
    const offset = this.randConfig.tapOffset;
    return Math.round(v + (Math.random() * 2 - 1) * offset);
  }

  setRandomizationEnabled(enabled: boolean): void {
    this.randConfig.enabled = enabled;
  }

  setRandomizationConfig(config: Partial<RandomizationConfig>): void {
    Object.assign(this.randConfig, config);
  }

  protected execAsync = promisify(exec);

  constructor(deviceId: string) {
    if (!deviceId) throw new Error('AdbDevice 必须传入 deviceId');
    this.deviceId = deviceId;
  }

  getDeviceId(): string {
    return this.deviceId;
  }

  async connect(): Promise<boolean> {
    try {
      // 仅对 host:port 形式的设备执行 adb connect（USB 设备如 emulator-5554 无需）
      if (this.deviceId.includes(':')) {
        await this.execAsync(`"${getAdbPath()}" connect ${this.deviceId}`).catch(() => {});
      }

      const { stdout } = await this.execAsync(`"${getAdbPath()}" devices`);
      const devices = stdout.split('\n')
        .filter(line => line.includes('\tdevice'))
        .map(line => line.split('\t')[0].trim());

      if (devices.includes(this.deviceId)) {
        this.connected = true;
        this.reconnectAttempts = 0;
        return true;
      }
      return false;
    } catch (e) {
      console.error(`ADB连接失败 (${this.deviceId}):`, e);
      return false;
    }
  }

  async disconnect(): Promise<void> {
    this.connected = false;
  }

  isConnected(): boolean {
    return this.connected;
  }

  async getDeviceInfo(): Promise<{ width: number; height: number }> {
    return { width: 1080, height: 1920 };
  }

  /**
   * Execute an ADB shell command with auto-reconnect on failure.
   * If the command fails, attempt to reconnect once and retry.
   */
  private async execAdb(command: string, description: string): Promise<void> {
    if (!this.connected) throw new Error('Device not connected');

    try {
      await this.execAsync(command);
      this.reconnectAttempts = 0;
    } catch (e) {
      if (this.reconnectAttempts >= this.maxReconnectAttempts) {
        this.connected = false;
        throw new Error(`ADB ${description} 失败（已重连 ${this.maxReconnectAttempts} 次）: ${e}`);
      }

      this.reconnectAttempts++;
      console.log(`[ADB] ${description} 失败，尝试重连 (${this.reconnectAttempts}/${this.maxReconnectAttempts})...`);

      // 延迟后重连，给模拟器启动时间
      await new Promise(r => setTimeout(r, this.reconnectDelayMs));
      await this.connect();

      if (!this.connected) {
        throw new Error(`ADB ${description} 失败：设备断连，重连失败`);
      }

      // 重试命令
      await this.execAsync(command);
      this.reconnectAttempts = 0;
    }
  }

  async screenshot(savePath?: string): Promise<Buffer> {
    if (!this.connected) throw new Error('Device not connected');

    if (savePath) {
      const remotePath = '/sdcard/screen.png';
      await this.execAdb(
        `"${getAdbPath()}" -s ${this.deviceId} shell screencap -p ${remotePath}`, '截图'
      );
      await this.execAdb(
        `"${getAdbPath()}" -s ${this.deviceId} pull ${remotePath} "${savePath}"`, '拉取截图'
      );
      return fs.promises.readFile(savePath);
    }

    // exec-out bypasses shell, outputs raw binary PNG via spawn
    return new Promise<Buffer>((resolve, reject) => {
      const doSpawn = () => {
        const child = spawn(ADB_PATH, ['-s', this.deviceId, 'exec-out', 'screencap', '-p'], {
          stdio: ['ignore', 'pipe', 'pipe']
        });
        const chunks: Buffer[] = [];
        child.stdout.on('data', (chunk: Buffer) => chunks.push(chunk));
        child.on('close', async (code) => {
          if (code === 0) {
            this.reconnectAttempts = 0;
            resolve(Buffer.concat(chunks));
            return;
          }
          if (this.reconnectAttempts >= this.maxReconnectAttempts) {
            this.connected = false;
            reject(new Error(`截图失败（已重连 ${this.maxReconnectAttempts} 次，exit code ${code}）`));
            return;
          }
          this.reconnectAttempts++;
          console.log(`[ADB] 截图失败，尝试重连 (${this.reconnectAttempts}/${this.maxReconnectAttempts})...`);
          // 延迟后重连，给模拟器启动时间
          await new Promise(r => setTimeout(r, this.reconnectDelayMs));
          await this.connect();
          if (!this.connected) {
            reject(new Error('截图失败：设备断连，重连失败'));
            return;
          }
          doSpawn();
        });
        child.on('error', reject);
      };
      doSpawn();
    });
  }

  async tap(x: number, y: number): Promise<void> {
    const tx = this.jitterCoord(x);
    const ty = this.jitterCoord(y);
    if (this.randConfig.enabled) {
      const pressDuration = 50 + Math.floor(Math.random() * 101); // 50-150ms
      await this.execAdb(
        `"${getAdbPath()}" -s ${this.deviceId} shell input swipe ${tx} ${ty} ${tx} ${ty} ${pressDuration}`,
        `按压 (${x},${y})→(${tx},${ty}) dur=${pressDuration}`
      );
    } else {
      await this.execAdb(
        `"${getAdbPath()}" -s ${this.deviceId} shell input tap ${tx} ${ty}`,
        `点击 (${x},${y})→(${tx},${ty})`
      );
    }
  }

  async tapPoint(point: Point): Promise<void> {
    await this.tap(point.x, point.y);
  }

  async swipe(x1: number, y1: number, x2: number, y2: number, duration: number = 500): Promise<void> {
    const sx1 = this.jitterCoord(x1);
    const sy1 = this.jitterCoord(y1);
    const sx2 = this.jitterCoord(x2);
    const sy2 = this.jitterCoord(y2);
    const jitteredDuration = Math.round(this.randConfig.enabled
      ? duration * (0.8 + Math.random() * 0.4)
      : duration);
    await this.execAdb(
      `"${getAdbPath()}" -s ${this.deviceId} shell input swipe ${sx1} ${sy1} ${sx2} ${sy2} ${jitteredDuration}`,
      `滑动 (${x1},${y1})→(${x2},${y2})→(${sx1},${sy1})→(${sx2},${sy2}) dur=${jitteredDuration}`
    );
  }

  async inputText(text: string): Promise<void> {
    await this.execAdb(
      `"${getAdbPath()}" -s ${this.deviceId} shell input text "${text}"`, '输入文本'
    );
  }

  async sleep(seconds: number, maxSeconds?: number): Promise<void> {
    let base: number;
    if (maxSeconds !== undefined && maxSeconds > seconds) {
      base = seconds + Math.random() * (maxSeconds - seconds);
    } else {
      base = seconds;
    }
    const actual = this.jitter(base);
    return new Promise(resolve => setTimeout(resolve, actual * 1000));
  }
}
