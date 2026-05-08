import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';
import { Device } from '../device';
import { Vision } from '../vision';

export class PluginContext {
  constructor(
    private device: Device,
    private vision: Vision,
    private config: Record<string, any> = {}
  ) {}

  async tap(x: number, y: number): Promise<void> {
    await this.device.tap(x, y);
  }

  async sleep(seconds: number): Promise<void> {
    await this.device.sleep(seconds);
  }

  async findImage(templatePath: string, threshold: number = 0.8): Promise<boolean> {
    const screenshotBuffer = await this.device.screenshot();
    const tempPath = path.join(os.tmpdir(), `screenshot-${Date.now()}.png`);
    await fs.writeFile(tempPath, screenshotBuffer);

    try {
      const result = await this.vision.findImage(tempPath, templatePath, threshold);
      return result.found;
    } finally {
      await fs.unlink(tempPath).catch(() => {});
    }
  }

  async tapImage(templatePath: string, threshold: number = 0.8): Promise<boolean> {
    const screenshotBuffer = await this.device.screenshot();
    const tempPath = path.join(os.tmpdir(), `screenshot-${Date.now()}.png`);
    await fs.writeFile(tempPath, screenshotBuffer);

    try {
      const result = await this.vision.findImage(tempPath, templatePath, threshold);
      if (result.found) {
        await this.device.tap(
          result.location.x + result.rect.width / 2,
          result.location.y + result.rect.height / 2
        );
        return true;
      }
      return false;
    } finally {
      await fs.unlink(tempPath).catch(() => {});
    }
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
    console.log(`[PluginContext] ${message}`);
  }
}
