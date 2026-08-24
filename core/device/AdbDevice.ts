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
  /** 最近一次 connect() 是否执行了 adb kill-server/start-server 重置 */
  private connectResetAdb: boolean = false;
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
    const sign = Math.random() < 0.5 ? -1 : 1;
    const magnitude = offset * Math.random() * Math.random();
    return Math.round(v + sign * magnitude);
  }

  private biasedPointInRect(x1: number, y1: number, x2: number, y2: number): { x: number; y: number } {
    const left = Math.min(x1, x2);
    const right = Math.max(x1, x2);
    const top = Math.min(y1, y2);
    const bottom = Math.max(y1, y2);
    const centerX = (left + right) / 2;
    const centerY = (top + bottom) / 2;
    const halfW = (right - left) / 2;
    const halfH = (bottom - top) / 2;
    const biasedOffset = (range: number) => {
      const sign = Math.random() < 0.5 ? -1 : 1;
      return sign * range * Math.random() * Math.random();
    };
    const x = Math.max(left, Math.min(right, Math.round(centerX + biasedOffset(halfW))));
    const y = Math.max(top, Math.min(bottom, Math.round(centerY + biasedOffset(halfH))));
    return { x, y };
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

  /** 最近一次 connect() 是否触发了 adb server 重置（用于给用户更准确的提示） */
  didResetAdbOnLastConnect(): boolean {
    return this.connectResetAdb;
  }

  async connect(): Promise<boolean> {
    this.connectResetAdb = false;
    try {
      if (await this.tryConnectOnce()) {
        this.connected = true;
        this.reconnectAttempts = 0;
        return true;
      }

      // 首次连接失败：ADB server 可能处于坏状态（版本冲突、残留僵死进程等）。
      // 用户反馈"重启电脑后能连上"即根因在此——重启会重置 adb server。
      // 这里自动 kill-server / start-server 后重试一次，避免用户重启电脑。
      console.log(`[ADB] 首次连接 ${this.deviceId} 未找到设备，重置 adb server 后重试...`);
      this.connectResetAdb = true;
      try {
        await this.execAsync(`"${getAdbPath()}" kill-server`);
      } catch (e) {
        console.log(`[ADB] kill-server 异常（可忽略）: ${(e as Error).message}`);
      }
      try {
        await this.execAsync(`"${getAdbPath()}" start-server`);
      } catch (e) {
        console.error(`[ADB] start-server 失败:`, e);
      }

      if (await this.tryConnectOnce()) {
        this.connected = true;
        this.reconnectAttempts = 0;
        console.log(`[ADB] 重置 adb server 后连接 ${this.deviceId} 成功`);
        return true;
      }

      console.error(`ADB连接失败 (${this.deviceId}): 重置 adb server 后仍未找到设备`);
      return false;
    } catch (e) {
      console.error(`ADB连接异常 (${this.deviceId}):`, e);
      return false;
    }
  }

  /**
   * 执行一次 connect + devices 查询，返回设备是否在线。
   * 仅 host:port 形式（网络设备）需要 adb connect；USB 设备如 emulator-5554 无需。
   */
  private async tryConnectOnce(): Promise<boolean> {
    if (this.deviceId.includes(':')) {
      try {
        const { stdout } = await this.execAsync(`"${getAdbPath()}" connect ${this.deviceId}`);
        if (stdout && stdout.trim()) console.log(`[ADB] connect ${this.deviceId}: ${stdout.trim()}`);
      } catch (e) {
        console.log(`[ADB] connect ${this.deviceId} 异常: ${(e as Error).message}`);
      }
    }

    const { stdout } = await this.execAsync(`"${getAdbPath()}" devices`);
    const devices = stdout.split('\n')
      .filter(line => line.includes('\tdevice'))
      .map(line => line.split('\t')[0].trim());

    return devices.includes(this.deviceId);
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
   * 执行任意 ADB shell 命令，返回 stdout（不经 input/screencap 包装）。
   * 用于 am force-stop / monkey 等系统命令。
   */
  async execShell(cmd: string): Promise<{ stdout: string; stderr: string }> {
    if (!this.connected) throw new Error('Device not connected');
    const fullCmd = `"${getAdbPath()}" -s ${this.deviceId} shell ${cmd}`;

    try {
      const result = await this.execAsync(fullCmd);
      this.reconnectAttempts = 0;
      return { stdout: result.stdout, stderr: result.stderr };
    } catch (e) {
      if (this.reconnectAttempts >= this.maxReconnectAttempts) {
        this.connected = false;
        throw new Error(`ADB execShell 失败（已重连 ${this.maxReconnectAttempts} 次）: ${e}`);
      }
      this.reconnectAttempts++;
      console.log(`[ADB] execShell 失败，尝试重连 (${this.reconnectAttempts}/${this.maxReconnectAttempts})...`);
      await new Promise(r => setTimeout(r, this.reconnectDelayMs));
      await this.connect();
      if (!this.connected) {
        throw new Error('ADB execShell 失败：设备断连，重连失败');
      }
      const result = await this.execAsync(fullCmd);
      this.reconnectAttempts = 0;
      return { stdout: result.stdout, stderr: result.stderr };
    }
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

  async tapRect(x1: number, y1: number, x2: number, y2: number): Promise<void> {
    const { x, y } = this.randConfig.enabled
      ? this.biasedPointInRect(x1, y1, x2, y2)
      : { x: Math.round((x1 + x2) / 2), y: Math.round((y1 + y2) / 2) };
    if (this.randConfig.enabled) {
      const pressDuration = 50 + Math.floor(Math.random() * 101); // 50-150ms
      await this.execAdb(
        `"${getAdbPath()}" -s ${this.deviceId} shell input swipe ${x} ${y} ${x} ${y} ${pressDuration}`,
        `范围按压 (${x1},${y1})-(${x2},${y2})→(${x},${y}) dur=${pressDuration}`
      );
    } else {
      await this.execAdb(
        `"${getAdbPath()}" -s ${this.deviceId} shell input tap ${x} ${y}`,
        `范围点击 (${x1},${y1})-(${x2},${y2})→(${x},${y})`
      );
    }
  }

  async tapPoint(point: Point): Promise<void> {
    await this.tap(point.x, point.y);
  }

  /**
   * 二次贝塞尔曲线生成自然滑动轨迹
   * 随机控制点模拟人类滑动的自然曲线偏移
   */
  private bezierCurve(x1: number, y1: number, x2: number, y2: number, steps: number): Array<{ x: number; y: number }> {
    // 随机控制点：偏离直线 15-35px，模拟自然手部抖动
    const midX = (x1 + x2) / 2;
    const midY = (y1 + y2) / 2;
    const offsetX = (Math.random() * 2 - 1) * (15 + Math.random() * 20);
    const offsetY = (Math.random() * 2 - 1) * (15 + Math.random() * 20);
    const cx = midX + offsetX;
    const cy = midY + offsetY;

    const points: Array<{ x: number; y: number }> = [];
    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      // easeOutQuad 缓动函数：先快后慢，模拟人类滑动减速停止的自然特征
      const easeT = 1 - (1 - t) * (1 - t);
      // 二次贝塞尔公式
      const x = Math.round((1 - easeT) * (1 - easeT) * x1 + 2 * (1 - easeT) * easeT * cx + easeT * easeT * x2);
      const y = Math.round((1 - easeT) * (1 - easeT) * y1 + 2 * (1 - easeT) * easeT * cy + easeT * easeT * y2);
      points.push({ x, y });
    }
    return points;
  }

  async swipe(x1: number, y1: number, x2: number, y2: number, duration: number = 500, useBezier: boolean = false, singleShot: boolean = false): Promise<void> {
    const sx1 = this.jitterCoord(x1);
    const sy1 = this.jitterCoord(y1);
    const sx2 = this.jitterCoord(x2);
    const sy2 = this.jitterCoord(y2);
    const jitteredDuration = Math.round(this.randConfig.enabled
      ? duration * (0.8 + Math.random() * 0.4)
      : duration);

    // singleShot：一条原始 input swipe，不分段（用于短 fling 触发惯性）
    if (singleShot) {
      await this.execAdb(
        `"${getAdbPath()}" -s ${this.deviceId} shell input swipe ${sx1} ${sy1} ${sx2} ${sy2} ${jitteredDuration}`,
        `单次滑动 (${x1},${y1})→(${x2},${y2}) dur=${jitteredDuration}`
      );
      return;
    }

    if (!this.randConfig.enabled || !useBezier) {
      // 普通直线滑动（默认）：3-5 段 + Y 轴微小偏移
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
          `滑动段${i}/${segments} (${cx},${cy})→(${nx},${ny}) dur=${segDuration}`
        );
        cx = nx;
        cy = ny;
      }
      return;
    }

    // 贝塞尔曲线滑动（仅 useBezier=true 时启用）：5-8 段，先快后慢，自然曲线
    const segments = 5 + Math.floor(Math.random() * 4); // 5-8 段
    const points = this.bezierCurve(sx1, sy1, sx2, sy2, segments);

    // 每段时长不均匀：前段快，后段慢（模拟减速）
    const baseDuration = jitteredDuration / segments;
    let cx = sx1, cy = sy1;

    for (let i = 1; i < points.length; i++) {
      const { x: nx, y: ny } = points[i];
      // 进度越往后，段时长越长（减速效果）
      const progress = i / segments;
      const segDuration = Math.round(baseDuration * (0.6 + progress * 0.8));

      await this.execAdb(
        `"${getAdbPath()}" -s ${this.deviceId} shell input swipe ${cx} ${cy} ${nx} ${ny} ${segDuration}`,
        `贝塞尔滑动段${i}/${segments} (${cx},${cy})→(${nx},${ny}) dur=${segDuration}`
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
   * 无惯性直线拖动：按下 → 沿直线分步移动到终点 → 保持静止 holdMs → 抬起。
   *
   * 与 swipe 的区别在于抬手前有一段静止：Android 的 VelocityTracker 取的是抬手瞬间的
   * 速度，静止一段后速度归零，就不会触发 fling（惯性滚动）。因此列表位移严格等于
   * 拖拽距离，可按像素精确翻页，且不受模拟器性能影响。
   *
   * 路径为严格直线、位移严格等于传入的 (x2-x1, y2-y1)：只对起点做随机抖动，
   * 终点按位移推算，避免两端独立抖动破坏距离精度。
   *
   * @param holdMs 抬手前静止时长
   * @param moveMs 手指移动这段的总时长（在 MOVE 之间插入等间隔停顿摊开）。
   *               0 = 尽可能快（约 85ms 走完）。移动越慢末速度越低，越不容易触发 fling。
   * @param steps  移动分几步
   *
   * 用 `input motionevent`（Android 9+ / API 28+）实现；整串命令拼在一次 shell 调用里，
   * 时序由设备端的 sleep 控制，避免多次 adb 往返带来的抖动。
   */
  async dragNoFling(
    x1: number, y1: number,
    x2: number, y2: number,
    holdMs: number = 1000,
    moveMs: number = 0,
    steps: number = 8
  ): Promise<void> {
    // 只抖动起点，终点按精确位移推算：
    // 若起终点各自独立抖动，位移就会变成 504±抖动，破坏按像素翻页的精度；
    // 且 x 两端抖不同值会让路径变成斜线。这样既保留位置随机化，又保证
    // 路径为直线、位移严格等于 (x2-x1, y2-y1)。
    const dx = Math.round(x2 - x1);
    const dy = Math.round(y2 - y1);
    const sx1 = Math.round(this.jitterCoord(x1));
    const sy1 = Math.round(this.jitterCoord(y1));
    const sx2 = sx1 + dx;
    const sy2 = sy1 + dy;

    const n = Math.max(1, steps);
    // 把 moveMs 摊成 n 段等间隔停顿，插在每步 MOVE 前，让移动匀速走满指定时长。
    // 命令本身还有约 85ms 开销，所以实际略长于 moveMs。
    const gapSec = moveMs > 0 ? (moveMs / 1000 / n) : 0;
    const gap = gapSec > 0 ? `sleep ${gapSec.toFixed(3)}; ` : '';
    const parts: string[] = [`input motionevent DOWN ${sx1} ${sy1}`];
    for (let i = 1; i <= n; i++) {
      const mx = sx1 + Math.round((dx * i) / n);
      const my = sy1 + Math.round((dy * i) / n);
      parts.push(`${gap}input motionevent MOVE ${mx} ${my}`);
    }
    // 抬手前静止：让 VelocityTracker 采到 0 速度，抑制 fling
    parts.push(`sleep ${(holdMs / 1000).toFixed(2)}`);
    parts.push(`input motionevent UP ${sx2} ${sy2}`);

    await this.execShell(parts.join('; '));
  }

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
    const sx1 = this.jitterCoord(x1);
    const sy1 = this.jitterCoord(y1);
    const sx2 = this.jitterCoord(x2);
    const sy2 = this.jitterCoord(y2);
    // 单次连续滑动：手指在移动中，结束时游戏视为 swipe-end 而非 tap
    const cmd = `"${getAdbPath()}" -s ${this.deviceId} shell input swipe ${sx1} ${sy1} ${sx2} ${sy2} ${holdMs}`;
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
