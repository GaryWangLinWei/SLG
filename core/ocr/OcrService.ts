import Tesseract from 'tesseract.js';
import { getTraineddataDir, getTemplatesDir } from '../resourcePath';
import sharp from 'sharp';
import * as fs from 'fs/promises';
import * as path from 'path';
import { getDigitMatcher, expectedGlyphGroups } from '../vision/DigitTemplateMatcher';
import { parseCountdown } from './parseCountdown';

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
   * 倒计时文字通常很小且背景多样（蓝底白字、暗底白字），单一路径容易漏识或粘连。
   * 这里同时识别「原图」和「3 倍放大 + 灰度 + 高阈值二值化」两张图，
   * 再用 parseCountdown 各自解析：两者都合法时取秒数更小的结果
   * （前导杂讯数字只会让结果偏大，真实时间是最小的合法值）。
   * 返回原始 OCR 文本，由调用方再做一次 parseCountdown（保证日志可追溯）。
   */
  async readCountdown(imagePath: string): Promise<string> {
    let processedPath: string | null = null;
    try {
      const meta = await sharp(imagePath).metadata();
      const w = (meta.width || 200) * 3;
      const h = (meta.height || 60) * 3;

      const { data } = await sharp(imagePath)
        .removeAlpha()
        .resize({ width: w, height: h, fit: 'fill' })
        .grayscale()
        .linear(1.4, -40)        // 提高对比度、压暗暗背景
        .raw()
        .toBuffer({ resolveWithObject: true });

      // 高阈值二值化（>=175 判白）：阈值过低会把蓝底白字的笔画膨胀粘连。
      const out = Buffer.alloc(data.length);
      for (let i = 0; i < data.length; i++) out[i] = data[i] >= 175 ? 255 : 0;

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

    const candidates: string[] = [];
    try {
      // 原图
      try {
        candidates.push(await this.recognizeWithTimeout(worker, imagePath));
      } catch { /* ignore single-channel failure */ }
      // 预处理图
      if (processedPath) {
        try {
          candidates.push(await this.recognizeWithTimeout(worker, processedPath));
        } catch { /* ignore */ }
      }
    } finally {
      if (this.worker === worker) {
        await worker.setParameters({ tessedit_char_whitelist: '' }).catch(() => {});
      }
      if (processedPath) {
        await fs.unlink(processedPath).catch(() => {});
      }
    }

    if (candidates.length === 0) return '';

    // 选秒数最小的合法结果；都不合法则返回原图文本。
    let bestText = candidates[0];
    let bestSec: number | null = parseCountdown(bestText);
    for (let i = 1; i < candidates.length; i++) {
      const sec = parseCountdown(candidates[i]);
      if (sec == null) continue;
      if (bestSec == null || sec < bestSec) {
        bestSec = sec;
        bestText = candidates[i];
      }
    }
    return bestText;
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
   *
   * 宝石数量区域是紧裁剪、画面内只有数字，因此关掉 `gapChain`：
   * 千位分隔符会让跨逗号的相邻数字间距达到 ~22px，锚点贪婪连接（maxDigitGap=20）
   * 会误判为无关内容而断链，只返回逗号一侧（43,106 → "43" 或 "106"，取决于哪个簇分数最高）。
   */
  async readGemCount(imagePath: string): Promise<string> {
    const digitMatcher = await getDigitMatcher(path.join(getTemplatesDir(), 'digits_gem'));
    if (digitMatcher.hasTemplates()) {
      const r = await digitMatcher.recognizeDetailed(imagePath, 0.75, { gapChain: false });

      if (r.digitCount > 0) {
        const expected = expectedGlyphGroups(r.digitCount);
        if (r.glyphGroups === expected) {
          console.log(`[DigitMatcher] 宝石数量识别结果: "${r.text}"`);
          return r.text;
        }
        // 画面里的字形组数多于命中的数字位数 → 有字形没被识别出来，读数不完整。
        // 宁可返回空让调用方判为失败，也不要返回一个「看起来合理」的错值
        // （如 25,275 少读一位变成 2527），更不要拿同一批像素交给 Tesseract 再猜一次。
        console.warn(
          `[DigitMatcher] 宝石数量读数不完整，丢弃 "${r.text}"：` +
          `命中 ${r.digitCount} 位应对应 ${expected} 个字形组，实际检出 ${r.glyphGroups} 组`
        );
        return '';
      }
      // 一个数字都没命中（可能是分辨率/字体差异）：交给 Tesseract 兜底
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
