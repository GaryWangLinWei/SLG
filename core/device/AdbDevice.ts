import { Device } from './Device';
import { Point } from '../types';
import { exec, spawn, ChildProcess } from 'child_process';
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
  private touchCalibration: { maxX: number; maxY: number } | null = null;

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
        const child = spawn(getAdbPath(), ['-s', this.deviceId, 'exec-out', 'screencap', '-p'], {
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

    if (!this.randConfig.enabled) {
      await this.execAdb(
        `"${getAdbPath()}" -s ${this.deviceId} shell input swipe ${sx1} ${sy1} ${sx2} ${sy2} ${jitteredDuration}`,
        `滑动 (${x1},${y1})→(${x2},${y2}) dur=${jitteredDuration}`
      );
      return;
    }

    const segments = 3 + Math.floor(Math.random() * 3); // 3-5
    const segDuration = Math.round(jitteredDuration / segments);
    let cx = sx1, cy = sy1;

    for (let i = 1; i <= segments; i++) {
      const t = i / segments;
      const nx = Math.round(sx1 + (sx2 - sx1) * t);
      const ny = Math.round(sy1 + (sy2 - sy1) * t + (Math.random() * 2 - 1) * 7);
      await this.execAdb(
        `"${getAdbPath()}" -s ${this.deviceId} shell input swipe ${cx} ${cy} ${nx} ${ny} ${segDuration}`,
        `曲线滑动段${i}/${segments} (${cx},${cy})→(${nx},${ny}) dur=${segDuration}`
      );
      cx = nx;
      cy = ny;
    }
  }

  /** 将屏幕坐标（1600×900 游戏坐标系）转换为触摸设备原始坐标 */
  private screenToTouch(screenX: number, screenY: number): { x: number; y: number } {
    const cal = this.touchCalibration;
    if (!cal) return { x: screenX, y: screenY };

    // 比较触摸轴比例与屏幕比例判断是否 XY 交换
    const touchRatio = cal.maxX / cal.maxY;       // 900/1600 = 0.5625
    const screenRatio = 1600 / 900;                // ≈ 1.778
    const swapped = Math.abs(touchRatio - 900 / 1600) < Math.abs(touchRatio - 1600 / 900);

    if (swapped) {
      // 触摸 X 对应屏幕 Y，触摸 Y 对应屏幕 X
      return {
        x: Math.round(screenY * cal.maxX / 900),
        y: Math.round(screenX * cal.maxY / 1600),
      };
    } else {
      return {
        x: Math.round(screenX * cal.maxX / 1600),
        y: Math.round(screenY * cal.maxY / 900),
      };
    }
  }

  async pinch(x1: number, y1: number, x2: number, y2: number, toX1: number, toY1: number, toX2: number, toY2: number, duration: number = 500): Promise<void> {
    if (!this.connected) throw new Error('Device not connected');

    // Use sendevent with Protocol B (ABS_MT_SLOT) — the only reliable multi-touch method on older Android
    const touchDev = await this.getTouchDevice();
    if (!touchDev) throw new Error('Cannot find touch input device for pinch gesture');

    // Convert screen coordinates to touch device raw coordinates
    const s1 = this.screenToTouch(x1, y1);
    const e1 = this.screenToTouch(toX1, toY1);
    const s2 = this.screenToTouch(x2, y2);
    const e2 = this.screenToTouch(toX2, toY2);

    // Event codes:
    //   3  = EV_ABS,    47 = ABS_MT_SLOT,  53 = ABS_MT_POSITION_X
    //   54 = ABS_MT_POSITION_Y,  57 = ABS_MT_TRACKING_ID,  58 = ABS_MT_PRESSURE
    //   0  = EV_SYN,     2 = SYN_MT_REPORT,  0 = SYN_REPORT

    const steps = 10;
    const stepDuration = Math.floor(duration / steps);

    try {
      for (let i = 0; i <= steps; i++) {
        const t = i / steps;
        const cx1 = Math.round(s1.x + (e1.x - s1.x) * t);
        const cy1 = Math.round(s1.y + (e1.y - s1.y) * t);
        const cx2 = Math.round(s2.x + (e2.x - s2.x) * t);
        const cy2 = Math.round(s2.y + (e2.y - s2.y) * t);

        if (i === 0) {
          // First frame: two fingers down on slot 0 and slot 1
          await this.execAsync(
            `"${getAdbPath()}" -s ${this.deviceId} shell sendevent ${touchDev} 3 47 0; sendevent ${touchDev} 3 57 0; sendevent ${touchDev} 3 53 ${cx1}; sendevent ${touchDev} 3 54 ${cy1}; sendevent ${touchDev} 3 58 50; sendevent ${touchDev} 0 2 0; sendevent ${touchDev} 3 47 1; sendevent ${touchDev} 3 57 1; sendevent ${touchDev} 3 53 ${cx2}; sendevent ${touchDev} 3 54 ${cy2}; sendevent ${touchDev} 3 58 50; sendevent ${touchDev} 0 2 0; sendevent ${touchDev} 0 0 0`
          );
        } else if (i === steps) {
          // Last frame: lift BOTH fingers (slot 0 and slot 1)
          await this.execAsync(
            `"${getAdbPath()}" -s ${this.deviceId} shell sendevent ${touchDev} 3 47 0; sendevent ${touchDev} 3 57 -1; sendevent ${touchDev} 0 2 0; sendevent ${touchDev} 3 47 1; sendevent ${touchDev} 3 57 -1; sendevent ${touchDev} 0 2 0; sendevent ${touchDev} 0 0 0`
          );
        } else {
          // Move both fingers (select slot, update coords, no tracking ID change needed)
          await this.execAsync(
            `"${getAdbPath()}" -s ${this.deviceId} shell sendevent ${touchDev} 3 47 0; sendevent ${touchDev} 3 53 ${cx1}; sendevent ${touchDev} 3 54 ${cy1}; sendevent ${touchDev} 0 2 0; sendevent ${touchDev} 3 47 1; sendevent ${touchDev} 3 53 ${cx2}; sendevent ${touchDev} 3 54 ${cy2}; sendevent ${touchDev} 0 2 0; sendevent ${touchDev} 0 0 0`
          );
        }

        if (i < steps) await new Promise(r => setTimeout(r, stepDuration));
      }
    } finally {
      // Cleanup: lift ALL 10 possible slots (0-9) + reset Android framework touch state.
      // This is awaited synchronously so the kernel state is clean before we return.
      try {
        const liftParts: string[] = [];
        for (let slot = 0; slot < 10; slot++) {
          liftParts.push(`sendevent ${touchDev} 3 47 ${slot}`);
          liftParts.push(`sendevent ${touchDev} 3 57 -1`);
          liftParts.push(`sendevent ${touchDev} 0 2 0`);
        }
        liftParts.push(`sendevent ${touchDev} 0 0 0`);
        await this.execAsync(
          `"${getAdbPath()}" -s ${this.deviceId} shell ${liftParts.join('; ')}`
        );
      } catch { /* best-effort cleanup, ignore errors */ }
    }
  }

  /** Find the touchscreen input device, cached. Throws descriptive error on failure. */
  private async getTouchDevice(): Promise<string> {
    if ((this as any).__touchDevice !== undefined) return (this as any).__touchDevice;

    // Method 1: read /proc/bus/input/devices (works on most Android)
    try {
      const { stdout } = await this.execAsync(
        `"${getAdbPath()}" -s ${this.deviceId} shell cat /proc/bus/input/devices`
      );
      console.log(`[AdbDevice] /proc/bus/input/devices:\n${stdout}`);
      const blocks = stdout.split(/\n\n|\n\s*\n/);
      for (const block of blocks) {
        if (/touch|ts|mt|multi|synaptics|ft5x|gt9x/i.test(block)) {
          const m = block.match(/Handlers=.*?(event\d+)/);
          if (m) {
            const dev = `/dev/input/${m[1]}`;
            console.log(`[AdbDevice] Found touch device: ${dev} (via /proc match)`);
            (this as any).__touchDevice = dev;
            await this.calibrateTouchAxes(dev);
            return dev;
          }
        }
      }
    } catch (e: any) { console.log(`[AdbDevice] /proc fallback failed: ${e.message}`); }

    // Method 2: enumerate /dev/input/event* with getevent -i
    try {
      const { stdout } = await this.execAsync(
        `"${getAdbPath()}" -s ${this.deviceId} shell "for dev in /dev/input/event0 /dev/input/event1 /dev/input/event2 /dev/input/event3 /dev/input/event4 /dev/input/event5 /dev/input/event6 /dev/input/event7 /dev/input/event8 /dev/input/event9; do test -e \\$dev && getevent -i \\$dev 2>/dev/null | grep -iqE 'touch|mt|ABS_MT' && echo \\$dev; done"`
      );
      console.log(`[AdbDevice] getevent -i search result: "${stdout.trim()}"`);
      const lines = stdout.trim().split('\n');
      if (lines[0]?.trim()) {
        const dev = lines[0].trim();
        console.log(`[AdbDevice] Found touch device: ${dev} (via getevent -i)`);
        (this as any).__touchDevice = dev;
        await this.calibrateTouchAxes(dev);
        return dev;
      }
    } catch (e: any) { console.log(`[AdbDevice] getevent search failed: ${e.message}`); }

    // Method 3: brute force — probe common paths with a harmless sendevent
    for (const dev of ['/dev/input/event4', '/dev/input/event2', '/dev/input/event1', '/dev/input/event3', '/dev/input/event5', '/dev/input/event0']) {
      try {
        await this.execAsync(
          `"${getAdbPath()}" -s ${this.deviceId} shell sendevent ${dev} 3 57 -1; sendevent ${dev} 0 0 0`
        );
        console.log(`[AdbDevice] sendevent probe OK on ${dev}, using as touch device`);
        (this as any).__touchDevice = dev;
        await this.calibrateTouchAxes(dev);
        return dev;
      } catch { /* continue */ }
    }

    throw new Error('Cannot find touch input device. Run: adb shell cat /proc/bus/input/devices | grep -i touch');
  }

  /** Query touch device axis ranges and cache calibration data */
  private async calibrateTouchAxes(dev: string): Promise<void> {
    try {
      const { stdout } = await this.execAsync(
        `"${getAdbPath()}" -s ${this.deviceId} shell getevent -p ${dev} 2>&1`
      );
      // getevent -p 输出十六进制事件码: 0035=ABS_MT_POSITION_X, 0036=ABS_MT_POSITION_Y
      const xMatch = stdout.match(/0035\s*:.*?max\s+(\d+)/);
      const yMatch = stdout.match(/0036\s*:.*?max\s+(\d+)/);
      if (xMatch && yMatch) {
        this.touchCalibration = {
          maxX: parseInt(xMatch[1], 10),
          maxY: parseInt(yMatch[1], 10),
        };
        const swapped = Math.abs(this.touchCalibration.maxX / this.touchCalibration.maxY - 900 / 1600)
                      < Math.abs(this.touchCalibration.maxX / this.touchCalibration.maxY - 1600 / 900);
        console.log(`[AdbDevice] Touch calibration: maxX=${this.touchCalibration.maxX}, maxY=${this.touchCalibration.maxY}, swapped=${swapped}`);
      }
    } catch (e: any) {
      console.log(`[AdbDevice] Touch calibration failed: ${e.message}`);
    }
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

  private holdProcess: ChildProcess | null = null;

  /**
   * 拖动到目标位置并保持按住（不松手）。
   * 使用单次 input swipe，手指从起点移动到终点，终点自然释放被游戏视为滑动结束而非点击。
   * spawn 非阻塞，调用后等待 ~0.15s 即可开始截图/检测。
   */
  async swipeAndHold(
    x1: number, y1: number,
    x2: number, y2: number,
    holdMs: number = 500
  ): Promise<void> {
    // 单次连续滑动：手指在移动中，结束时游戏视为 swipe-end 而非 tap
    const cmd = `"${getAdbPath()}" -s ${this.deviceId} shell input swipe ${x1} ${y1} ${x2} ${y2} ${holdMs}`;
    this.holdProcess = spawn(cmd, [], { shell: true, stdio: 'ignore' });
    this.holdProcess.on('error', () => {});

    // 等待手指到达屏幕中段区域（holdMs * 0.3）
    await new Promise(resolve => setTimeout(resolve, Math.round(holdMs * 0.3)));
  }

  /**
   * 释放 swipeAndHold 的按住状态。
   * 等待 ADB swipe 进程结束，确保触摸已完全释放后再返回，
   * 避免后续 tap/swipe 与尚未结束的 hold 手势冲突。
   */
  async releaseHold(): Promise<void> {
    if (this.holdProcess) {
      // 等待 ADB 进程退出（swipe 在设备端自然结束、手指释放）
      if (this.holdProcess.exitCode === null) {
        await new Promise<void>((resolve) => {
          this.holdProcess!.once('close', () => resolve());
        });
      }
      this.holdProcess = null;
    }
  }
}
