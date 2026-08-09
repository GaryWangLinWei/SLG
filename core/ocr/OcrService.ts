import Tesseract from 'tesseract.js';
import { getTraineddataDir, getTemplatesDir } from '../resourcePath';
import sharp from 'sharp';
import * as fs from 'fs/promises';
import * as path from 'path';
import { getDigitMatcher } from '../vision/DigitTemplateMatcher';

type OcrWorker = Tesseract.Worker;

const LANG_PATH = getTraineddataDir();

// OCR 单次识别超时（ms）。tesseract.js worker 偶发卡死，超时后强制 terminate 重建。
const OCR_TIMEOUT_MS = 8000;
const OCR_TIMEOUT_MS_CHS = 15000;

class OcrService {
  private worker: OcrWorker | null = null;
  private workerChs: OcrWorker | null = null;

  private async getWorker(): Promise<OcrWorker> {
    if (!this.worker) {
      this.worker = await Tesseract.createWorker('eng', 1, { langPath: LANG_PATH });
    }
    return this.worker;
  }

  private async getChineseWorker(): Promise<OcrWorker> {
    if (!this.workerChs) {
      this.workerChs = await Tesseract.createWorker('chi_sim', 1, { langPath: LANG_PATH });
    }
    return this.workerChs;
  }

  /**
   * 带超时的识别包装：超时时强制 terminate worker 并置空字段（下次调用自动重建），
   * 避免 tesseract.js worker 卡死后整个任务永久阻塞。
   */
  private async recognizeWithTimeout(
    worker: OcrWorker,
    imagePath: string,
    isChinese: boolean = false
  ): Promise<string> {
    const timeoutMs = isChinese ? OCR_TIMEOUT_MS_CHS : OCR_TIMEOUT_MS;
    let timer: NodeJS.Timeout | undefined;
    try {
      const result = await Promise.race([
        worker.recognize(imagePath),
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => reject(new Error(`OCR 超时 (${timeoutMs}ms)`)), timeoutMs);
        }),
      ]);
      return (result as Tesseract.RecognizeResult).data.text.trim();
    } catch (err) {
      // 超时或识别失败：销毁卡死的 worker，让下次调用重建
      console.warn(`[OCR] recognize 失败/超时，重建 worker: ${(err as Error).message}`);
      try { await worker.terminate(); } catch { /* ignore */ }
      if (isChinese) this.workerChs = null; else this.worker = null;
      throw err;
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  /**
   * 识别图像中的文本
   */
  async readText(imagePath: string): Promise<string> {
    const worker = await this.getWorker();
    return this.recognizeWithTimeout(worker, imagePath);
  }

  /**
   * 识别队伍数（格式如 "2/4"）
   */
  async readTeamCount(imagePath: string): Promise<string> {
    const worker = await this.getWorker();
    await worker.setParameters({
      tessedit_char_whitelist: '0123456789/',
    });
    try {
      return await this.recognizeWithTimeout(worker, imagePath);
    } finally {
      // worker 可能已被 terminate（超时时），只有还活着才尝试还原参数
      if (this.worker === worker) {
        await worker.setParameters({ tessedit_char_whitelist: '' }).catch(() => {});
      }
    }
  }

  /**
   * 识别距离数字（如 "36" 从 "36公里"）
   * 优先使用模板匹配（准确率更高），没有模板时 fallback 到 Tesseract
   */
  async readDistance(imagePath: string): Promise<string> {
    const digitMatcher = await getDigitMatcher(path.join(getTemplatesDir(), 'digits_distance'));
    if (digitMatcher.hasTemplates()) {
      const result = await digitMatcher.recognize(imagePath, 0.75);
      console.log(`[DigitMatcher] 距离识别结果: "${result}"`);
      if (result) return result;
    }

    const worker = await this.getWorker();
    await worker.setParameters({
      tessedit_char_whitelist: '0123456789',
    });
    try {
      return await this.recognizeWithTimeout(worker, imagePath);
    } finally {
      if (this.worker === worker) {
        await worker.setParameters({ tessedit_char_whitelist: '' }).catch(() => {});
      }
    }
  }

  /**
   * 识别队列倒计时（格式如 "01:23:45" 或 "1h 23m"）。
   *
   * 倒计时文字通常很小，直接 OCR 容易把 "09" 识别成 "502" 等。先做图像预处理：
   * 2 倍放大 → 灰度 → 自适应阈值二值化，提升白字小数字的识别率。
   */
  async readCountdown(imagePath: string): Promise<string> {
    let processedPath: string | null = null;
    try {
      const meta = await sharp(imagePath).metadata();
      const w = (meta.width || 200) * 2;
      const h = (meta.height || 60) * 2;

      const { data } = await sharp(imagePath)
        .removeAlpha()
        .resize({ width: w, height: h, fit: 'fill' })
        .grayscale()
        .linear(1.4, -40)        // 提高对比度、压暗暗背景
        .raw()
        .toBuffer({ resolveWithObject: true });

      // 简单二值化：>=150 判白，否则黑
      const out = Buffer.alloc(data.length);
      for (let i = 0; i < data.length; i++) out[i] = data[i] >= 150 ? 255 : 0;

      processedPath = path.join(path.dirname(imagePath), `countdown-${Date.now()}.png`);
      await sharp(out, { raw: { width: w, height: h, channels: 1 } })
        .png()
        .toFile(processedPath);
    } catch {
      processedPath = null; // 预处理失败，退回原图
    }

    const worker = await this.getWorker();
    await worker.setParameters({
      tessedit_char_whitelist: '0123456789:hHmM',
    });
    try {
      return await this.recognizeWithTimeout(worker, processedPath ?? imagePath);
    } finally {
      if (this.worker === worker) {
        await worker.setParameters({ tessedit_char_whitelist: '' }).catch(() => {});
      }
      if (processedPath) {
        await fs.unlink(processedPath).catch(() => {});
      }
    }
  }

  /**
   * 识别宝石采集坐标（使用 Tesseract OCR）
   */
  async readCoordinates(imagePath: string): Promise<string> {
    const worker = await this.getWorker();
    await worker.setParameters({
      tessedit_char_whitelist: '0123456789',
    });
    try {
      const result = await this.recognizeWithTimeout(worker, imagePath);
      console.log(`[Tesseract] 宝石坐标识别结果: "${result}"`);
      return result;
    } finally {
      if (this.worker === worker) {
        await worker.setParameters({ tessedit_char_whitelist: '' }).catch(() => {});
      }
    }
  }

  /**
   * 识别山洞坐标（使用 Tesseract）
   */
  async readCaveCoordinates(imagePath: string): Promise<string> {
    const worker = await this.getWorker();
    await worker.setParameters({
      tessedit_char_whitelist: '0123456789',
    });
    try {
      const result = await this.recognizeWithTimeout(worker, imagePath);
      console.log(`[Tesseract] 山洞坐标识别结果: "${result}"`);
      return result;
    } finally {
      if (this.worker === worker) {
        await worker.setParameters({ tessedit_char_whitelist: '' }).catch(() => {});
      }
    }
  }

  /**
   * 识别图像中的数字
   */
  async readDigits(imagePath: string): Promise<string> {
    const worker = await this.getWorker();
    await worker.setParameters({
      tessedit_char_whitelist: '0123456789',
    });
    try {
      return await this.recognizeWithTimeout(worker, imagePath);
    } finally {
      if (this.worker === worker) {
        await worker.setParameters({ tessedit_char_whitelist: '' }).catch(() => {});
      }
    }
  }

  /**
   * 识别宝石数量（格式如 "5,562"，带千位分隔符）
   * 优先使用模板匹配（准确率更高），没有模板时 fallback 到 Tesseract
   */
  async readGemCount(imagePath: string): Promise<string> {
    const digitMatcher = await getDigitMatcher(path.join(getTemplatesDir(), 'digits_gem'));
    if (digitMatcher.hasTemplates()) {
      const result = await digitMatcher.recognize(imagePath, 0.75);
      console.log(`[DigitMatcher] 宝石数量识别结果: "${result}"`);
      if (result) return result;
    }

    const worker = await this.getWorker();
    await worker.setParameters({
      tessedit_char_whitelist: '0123456789,',
    });
    try {
      return await this.recognizeWithTimeout(worker, imagePath);
    } finally {
      if (this.worker === worker) {
        await worker.setParameters({ tessedit_char_whitelist: '' }).catch(() => {});
      }
    }
  }

  /**
   * 识别图像中的中文文本
   */
  async readChineseText(imagePath: string): Promise<string> {
    const worker = await this.getChineseWorker();
    return this.recognizeWithTimeout(worker, imagePath, true);
  }

  async destroy(): Promise<void> {
    if (this.worker) {
      await this.worker.terminate();
      this.worker = null;
    }
    if (this.workerChs) {
      await this.workerChs.terminate();
      this.workerChs = null;
    }
  }
}

export const ocrService = new OcrService();
