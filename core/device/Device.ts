import { Point, Rect } from '../types';

export interface Device {
  connect(): Promise<boolean>;
  disconnect(): Promise<void>;
  isConnected(): boolean;
  getDeviceInfo(): Promise<{ width: number; height: number }>;

  screenshot(savePath?: string): Promise<Buffer>;
  tap(x: number, y: number): Promise<void>;
  tapRect?(x1: number, y1: number, x2: number, y2: number): Promise<void>;
  tapPoint(point: Point): Promise<void>;
  swipe(x1: number, y1: number, x2: number, y2: number, duration?: number): Promise<void>;
  swipeAndHold?(x1: number, y1: number, x2: number, y2: number, holdMs?: number): Promise<void>;
  releaseHold?(): Promise<void>;
  pinch(x1: number, y1: number, x2: number, y2: number, toX1: number, toY1: number, toX2: number, toY2: number, duration?: number): Promise<void>;
  inputText(text: string): Promise<void>;
  execShell?(cmd: string): Promise<{ stdout: string; stderr: string }>;
  sleep(seconds: number, maxSeconds?: number): Promise<void>;
}
