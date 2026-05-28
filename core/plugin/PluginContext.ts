import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';
import sharp from 'sharp';
import { Device } from '../device';
import { Vision } from '../vision';

export class PluginContext {
  private logOutput: (msg: string) => void;
  private cache: Map<string, { x: number; y: number }> = new Map();
  constructor(
    private device: Device,
    private vision: Vision,
    private config: Record<string, any> = {},
    private checkStop?: () => void,
    logCallback?: (msg: string) => void
  ) {
    this.logOutput = logCallback ?? ((msg: string) => console.log(msg));
  }

  private checkCancellation(): void {
    if (this.checkStop) {
      this.checkStop();
    }
  }

  async tap(x: number, y: number): Promise<void> {
    this.checkCancellation();
    this.logOutput(`[TAP] (${x}, ${y})`);
    await this.device.tap(x, y);
    // 10% 概率追加微停顿，模拟操作犹豫
    if (Math.random() < 0.10) {
      await this.device.sleep(0.2 + Math.random() * 0.3); // 0.2-0.5s
    }
  }

  async sleep(seconds: number, maxSeconds?: number): Promise<void> {
    this.checkCancellation();
    await this.device.sleep(seconds, maxSeconds);
    // 5% 概率追加微停顿，模拟注意力分散
    if (Math.random() < 0.05) {
      await this.device.sleep(0.3 + Math.random() * 0.5); // 0.3-0.8s
    }
    this.checkCancellation();
  }

  /**
   * Check if template image exists on screen
   */
  async findImage(templatePath: string, threshold: number = 0.85, scales?: number[]): Promise<boolean> {
    const result = await this.findImageWithLocation(templatePath, threshold, scales);
    return result.found;
  }

  /**
   * Find template image and return its location and confidence.
   * When `scales` is provided, tries each scale and returns the best match.
   */
  async findImageWithLocation(
    templatePath: string,
    threshold: number = 0.85,
    scales?: number[]
  ): Promise<{ found: boolean; x: number; y: number; confidence: number }> {
    this.checkCancellation();
    const screenshotBuffer = await this.device.screenshot();
    const tempPath = path.join(os.tmpdir(), `screenshot-${Date.now()}.png`);
    await fs.writeFile(tempPath, screenshotBuffer);

    try {
      const result = await this.vision.findImage(tempPath, templatePath, threshold, scales);
      if (result.found) {
        const tapLoc = this.vision.getTapLocation(result);
        return {
          found: true,
          x: tapLoc.x,
          y: tapLoc.y,
          confidence: result.confidence
        };
      }
      return { found: false, x: 0, y: 0, confidence: result.confidence };
    } finally {
      await fs.unlink(tempPath).catch(() => {});
    }
  }

  /**
   * Find image and tap on its center. Returns true if found and tapped.
   */
  async tapImage(templatePath: string, threshold: number = 0.85, scales?: number[]): Promise<boolean> {
    const result = await this.findImageWithLocation(templatePath, threshold, scales);
    if (result.found) {
      this.logOutput(`[TAP-IMAGE] Found "${path.basename(templatePath)}" at (${result.x}, ${result.y}), confidence: ${result.confidence.toFixed(3)}`);
      await this.tap(result.x, result.y);
      return true;
    }
    this.logOutput(`[TAP-IMAGE] Not found "${path.basename(templatePath)}", best confidence: ${result.confidence.toFixed(3)}`);
    return false;
  }

  async swipe(x1: number, y1: number, x2: number, y2: number, duration: number = 500): Promise<void> {
    await this.device.swipe(x1, y1, x2, y2, duration);
  }

  async inputText(text: string): Promise<void> {
    await this.device.inputText(text);
  }

  async waitForImage(templatePath: string, timeout: number = 30, threshold: number = 0.8): Promise<boolean> {
    const startTime = Date.now();
    while (Date.now() - startTime < timeout * 1000) {
      if (await this.findImage(templatePath, threshold)) {
        return true;
      }
      await this.sleep(0.5);
    }
    return false;
  }

  async waitWhileImage(templatePath: string, timeout: number = 30, threshold: number = 0.8): Promise<boolean> {
    const startTime = Date.now();
    while (Date.now() - startTime < timeout * 1000) {
      if (!(await this.findImage(templatePath, threshold))) {
        return true;
      }
      await this.sleep(0.5);
    }
    return false;
  }

  getConfig<T = any>(key: string, defaultValue?: T): T {
    return this.config[key] ?? defaultValue;
  }

  log(message: string): void {
    this.logOutput(`[PluginContext] ${message}`);
  }

  /**
   * Capture a specific region of the screen and save to temp file
   */
  async captureRegion(
    x: number,
    y: number,
    width: number,
    height: number
  ): Promise<string> {
    const screenshotBuffer = await this.device.screenshot();
    const tempPath = path.join(os.tmpdir(), `region-${Date.now()}-${Math.random()}.png`);

    // Crop the screenshot to the specified region
    await sharp(screenshotBuffer)
      .extract({ left: x, top: y, width, height })
      .toFile(tempPath);

    return tempPath;
  }

  /**
   * Compare two images by pixel difference. Returns a value 0..1 (0 = identical).
   */
  async compareImages(path1: string, path2: string): Promise<number> {
    return this.vision.compareImages(path1, path2);
  }

  /**
   * Check button state change (used for verifying clicks succeeded)
   */
  async checkButtonStateChange(
    buttonX: number,
    buttonY: number,
    buttonWidth: number = 150,
    buttonHeight: number = 50,
    changeThreshold: number = 0.1
  ): Promise<{ changed: boolean; diffPercentage: number }> {
    // Calculate region (center on button coordinates)
    const regionX = buttonX - Math.floor(buttonWidth / 2);
    const regionY = buttonY - Math.floor(buttonHeight / 2);

    // Capture before click
    const beforePath = await this.captureRegion(regionX, regionY, buttonWidth, buttonHeight);

    // Click the button
    await this.tap(buttonX, buttonY);
    await this.sleep(0.5);

    // Capture after click
    const afterPath = await this.captureRegion(regionX, regionY, buttonWidth, buttonHeight);

    // Compare
    const diffPercentage = await this.vision.compareImages(beforePath, afterPath);

    // Cleanup temp files
    await Promise.all([
      fs.unlink(beforePath).catch(() => {}),
      fs.unlink(afterPath).catch(() => {})
    ]);

    return {
      changed: diffPercentage >= changeThreshold,
      diffPercentage
    };
  }

  /**
   * Compare a screen region against multiple reference templates
   * Returns the key with the smallest pixel difference (most similar)
   * Used for state detection (e.g., is button in state A or state B)
   */
  async detectState<T extends string>(
    regionX: number,
    regionY: number,
    width: number,
    height: number,
    templates: Record<T, string>,
    maxDiffThreshold: number = 0.3
  ): Promise<{ state: T | 'unknown'; diffs: Record<string, number> }> {
    const currentPath = await this.captureRegion(regionX, regionY, width, height);

    try {
      const diffs: Record<string, number> = {};
      let bestState: T | null = null;
      let bestDiff = Infinity;

      for (const [state, templatePath] of Object.entries(templates) as [T, string][]) {
        const diff = await this.vision.compareImages(currentPath, templatePath);
        diffs[state] = diff;
        if (diff < bestDiff) {
          bestDiff = diff;
          bestState = state;
        }
      }

      // If best match is still too different, return unknown
      if (bestDiff > maxDiffThreshold) {
        return { state: 'unknown', diffs };
      }

      return { state: bestState!, diffs };
    } finally {
      await fs.unlink(currentPath).catch(() => {});
    }
  }

  /**
   * 获取缓存的图像识别坐标（同一次循环中避免重复识别）
   */
  getCachedLocation(key: string): { x: number; y: number } | undefined {
    return this.cache.get(key);
  }

  /**
   * 缓存图像识别坐标
   */
  setCachedLocation(key: string, x: number, y: number): void {
    this.cache.set(key, { x, y });
  }
}
