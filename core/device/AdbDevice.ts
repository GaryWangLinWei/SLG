import { Device } from './Device';
import { Point } from '../types';
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

export class AdbDevice implements Device {
  private connected: boolean = false;
  private deviceId: string;

  constructor(deviceId?: string) {
    this.deviceId = deviceId || '';
  }

  async connect(): Promise<boolean> {
    try {
      const { stdout } = await execAsync('adb devices');
      const devices = stdout.split('\n')
        .filter(line => line.includes('\tdevice'))
        .map(line => line.split('\t')[0]);

      if (devices.length > 0) {
        this.deviceId = this.deviceId || devices[0];
        this.connected = true;
        return true;
      }
      return false;
    } catch {
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

  async screenshot(savePath?: string): Promise<Buffer> {
    throw new Error('Not implemented');
  }

  async tap(x: number, y: number): Promise<void> {
    if (!this.connected) throw new Error('Device not connected');
    await execAsync(`adb -s ${this.deviceId} shell input tap ${x} ${y}`);
  }

  async tapPoint(point: Point): Promise<void> {
    await this.tap(point.x, point.y);
  }

  async swipe(x1: number, y1: number, x2: number, y2: number, duration: number = 500): Promise<void> {
    if (!this.connected) throw new Error('Device not connected');
    await execAsync(`adb -s ${this.deviceId} shell input swipe ${x1} ${y1} ${x2} ${y2} ${duration}`);
  }

  async inputText(text: string): Promise<void> {
    if (!this.connected) throw new Error('Device not connected');
    await execAsync(`adb -s ${this.deviceId} shell input text "${text}"`);
  }

  async sleep(seconds: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, seconds * 1000));
  }
}
