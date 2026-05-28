import { Point, Rect } from '../types';

export interface Device {
  connect(): Promise<boolean>;
  disconnect(): Promise<void>;
  isConnected(): boolean;
  getDeviceInfo(): Promise<{ width: number; height: number }>;

  screenshot(savePath?: string): Promise<Buffer>;
  tap(x: number, y: number): Promise<void>;
  tapPoint(point: Point): Promise<void>;
  swipe(x1: number, y1: number, x2: number, y2: number, duration?: number): Promise<void>;
  inputText(text: string): Promise<void>;
  sleep(seconds: number, maxSeconds?: number): Promise<void>;
}
