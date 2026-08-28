import { Point, Rect } from '../types';
import { SwipeProfileMode } from './swipeProfile';

export interface Device {
  connect(): Promise<boolean>;
  disconnect(): Promise<void>;
  isConnected(): boolean;
  getDeviceInfo(): Promise<{ width: number; height: number }>;

  screenshot(savePath?: string): Promise<Buffer>;
  tap(x: number, y: number): Promise<void>;
  tapRect?(x1: number, y1: number, x2: number, y2: number): Promise<void>;
  tapPoint(point: Point): Promise<void>;
  swipe(x1: number, y1: number, x2: number, y2: number, duration?: number, useBezier?: boolean, singleShot?: boolean): Promise<void>;
  /** 拟人连续滑动：单次不间断手势走完曲线轨迹（见 AdbDevice.swipeHuman） */
  swipeHuman?(x1: number, y1: number, x2: number, y2: number, duration?: number, mode?: SwipeProfileMode, curveScale?: number, distJitter?: number): Promise<void>;
  swipeAndHold?(x1: number, y1: number, x2: number, y2: number, holdMs?: number): Promise<void>;
  releaseHold?(): Promise<void>;
  dragNoFling?(x1: number, y1: number, x2: number, y2: number, holdMs?: number, moveMs?: number, steps?: number, slopPx?: number): Promise<void>;
  pinch(x1: number, y1: number, x2: number, y2: number, toX1: number, toY1: number, toX2: number, toY2: number, duration?: number): Promise<void>;
  inputText(text: string): Promise<void>;
  execShell?(cmd: string): Promise<{ stdout: string; stderr: string }>;
  sleep(seconds: number, maxSeconds?: number): Promise<void>;
}
