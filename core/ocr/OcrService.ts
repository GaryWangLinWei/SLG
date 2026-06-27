import Tesseract from 'tesseract.js';
import { getTraineddataDir } from '../resourcePath';
import sharp from 'sharp';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';

type OcrWorker = Tesseract.Worker;

const LANG_PATH = getTraineddataDir();

/**
 * OCR 预处理配置
 */
interface PreprocessOptions {
  grayscale?: boolean;
  resizeWidth?: number;
  resizeHeight?: number;
  threshold?: number;
  sharpen?: number;
  normalize?: boolean;
  charWhitelist?: string;
}

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
   * 通用预处理管道
   */
  private async preprocessImage(
    imagePath: string,
    options: PreprocessOptions
  ): Promise<string> {
    const preprocessed = path.join(os.tmpdir(), `ocr-pre-${Date.now()}-${Math.random().toString(36).slice(2)}.png`);

    let pipeline = sharp(imagePath);

    if (options.grayscale !== false) {
      pipeline = pipeline.grayscale();
    }

    if (options.resizeWidth && options.resizeHeight) {
      pipeline = pipeline.resize({
        width: options.resizeWidth,
        height: options.resizeHeight,
        fit: 'fill',
        kernel: 'lanczos3'
      });
    }

    if (options.normalize !== false) {
      pipeline = pipeline.normalize();
    }

    if (options.sharpen) {
      pipeline = pipeline.sharpen({ sigma: options.sharpen });
    }

    if (options.threshold) {
      pipeline = pipeline.threshold(options.threshold);
    }

    const buf = await pipeline.toBuffer();
    await fs.writeFile(preprocessed, buf);
    return preprocessed;
  }

  /**
   * OCR 常见错误修正映射
   */
  private fixOcrErrors(text: string): string {
    const fixes: Record<string, string> = {
      'O': '0', 'o': '0', 'Q': '0', 'Ø': '0',
      'l': '1', 'I': '1', 'i': '1', '|': '1', '!': '1', 'Ⅰ': '1',
      'S': '5', 's': '5',
      'B': '8',
      'Z': '2', 'z': '2',
      'G': '6',
      ' ': '',  // 移除所有空格
      '\\': '/',
      '：': ':',  // 中文冒号转英文
      '，': ',',
      '。': '.',
    };

    let result = text;
    for (const [wrong, correct] of Object.entries(fixes)) {
      result = result.split(wrong).join(correct);
    }
    return result;
  }

  /**
   * 识别图像中的文本（通用方法，保持向后兼容）
   */
  async readText(imagePath: string): Promise<string> {
    const worker = await this.getWorker();
    const { data } = await worker.recognize(imagePath);
    return data.text.trim();
  }

  /**
   * 识别队伍数（格式如 "2/4"）
   * 针对小区域高对比度优化
   */
  async readTeamCount(imagePath: string): Promise<string> {
    const preprocessed = await this.preprocessImage(imagePath, {
      grayscale: true,
      resizeWidth: 150,
      resizeHeight: 80,
      normalize: true,
      sharpen: 1.2,
      threshold: 110,
    });

    try {
      const worker = await this.getWorker();
      await worker.setParameters({ tessedit_char_whitelist: '0123456789/' });
      const { data } = await worker.recognize(preprocessed);
      await worker.setParameters({ tessedit_char_whitelist: '' });
      const raw = data.text.trim();
      const fixed = this.fixOcrErrors(raw);
      return fixed;
    } finally {
      await fs.unlink(preprocessed).catch(() => {});
    }
  }

  /**
   * 识别距离数字（如 "36" 从 "36公里"）
   */
  async readDistance(imagePath: string): Promise<string> {
    const preprocessed = await this.preprocessImage(imagePath, {
      grayscale: true,
      resizeWidth: 240,
      resizeHeight: 100,
      normalize: true,
      sharpen: 1.5,
      threshold: 100,
    });

    try {
      // 调试：保存预处理后的图片
      const debugDir = path.join(process.cwd(), 'temp', 'debug', 'rally_ocr');
      await fs.mkdir(debugDir, { recursive: true });
      const debugFileName = `rally_dist_preprocess_${Date.now()}.png`;
      const debugSavePath = path.join(debugDir, debugFileName);
      await fs.copyFile(preprocessed, debugSavePath);
      console.log(`[OCR 调试] 预处理后图片已保存: ${debugSavePath}`);

      const worker = await this.getWorker();
      await worker.setParameters({ tessedit_char_whitelist: '0123456789' });
      const { data } = await worker.recognize(preprocessed);
      await worker.setParameters({ tessedit_char_whitelist: '' });
      const raw = data.text.trim();
      const fixed = this.fixOcrErrors(raw);

      // 只提取开头的连续数字（解决"2公里"识别成"27"的问题）
      const match = fixed.match(/^(\d+)/);
      const result = match ? match[1] : fixed;

      console.log(`[OCR 调试] 原始识别结果: "${raw}", 修正后: "${fixed}", 最终结果: "${result}"`);
      return result;
    } finally {
      await fs.unlink(preprocessed).catch(() => {});
    }
  }

  /**
   * 识别队列倒计时（格式如 "01:23:45" 或 "1h 23m"）
   */
  async readCountdown(imagePath: string): Promise<string> {
    const preprocessed = await this.preprocessImage(imagePath, {
      grayscale: true,
      resizeWidth: 240,
      resizeHeight: 80,
      normalize: true,
      sharpen: 1.5,
      threshold: 128,
    });

    try {
      const worker = await this.getWorker();
      await worker.setParameters({ tessedit_char_whitelist: '0123456789:hHmM' });
      const { data } = await worker.recognize(preprocessed);
      await worker.setParameters({ tessedit_char_whitelist: '' });
      const raw = data.text.trim();
      const fixed = this.fixOcrErrors(raw);
      return fixed;
    } finally {
      await fs.unlink(preprocessed).catch(() => {});
    }
  }

  /**
   * 识别坐标（格式如 "x: 123, y: 456"）
   */
  async readCoordinates(imagePath: string): Promise<string> {
    const preprocessed = await this.preprocessImage(imagePath, {
      grayscale: true,
      resizeWidth: 300,
      resizeHeight: 60,
      normalize: true,
      sharpen: 1.2,
      threshold: 115,
    });

    try {
      const worker = await this.getWorker();
      await worker.setParameters({ tessedit_char_whitelist: '0123456789xyXY,: ' });
      const { data } = await worker.recognize(preprocessed);
      await worker.setParameters({ tessedit_char_whitelist: '' });
      const raw = data.text.trim();
      const fixed = this.fixOcrErrors(raw);
      return fixed;
    } finally {
      await fs.unlink(preprocessed).catch(() => {});
    }
  }

  /**
   * 识别图像中的数字（升级优化版，保持向后兼容）
   */
  async readDigits(imagePath: string): Promise<string> {
    const preprocessed = await this.preprocessImage(imagePath, {
      grayscale: true,
      resizeWidth: 120,
      resizeHeight: 60,
      normalize: true,
      sharpen: 1.0,
      threshold: 128,
    });

    try {
      const worker = await this.getWorker();
      await worker.setParameters({ tessedit_char_whitelist: '0123456789' });
      const { data } = await worker.recognize(preprocessed);
      await worker.setParameters({ tessedit_char_whitelist: '' });
      const raw = data.text.trim();
      const fixed = this.fixOcrErrors(raw);
      return fixed;
    } finally {
      await fs.unlink(preprocessed).catch(() => {});
    }
  }

  /**
   * 识别图像中的中文文本（优化版）
   */
  async readChineseText(imagePath: string): Promise<string> {
    const preprocessed = await this.preprocessImage(imagePath, {
      grayscale: true,
      resizeWidth: 300,
      resizeHeight: 100,
      normalize: true,
      sharpen: 0.8,
      threshold: 130,
    });

    try {
      const worker = await this.getChineseWorker();
      const { data } = await worker.recognize(preprocessed);
      return data.text.trim();
    } finally {
      await fs.unlink(preprocessed).catch(() => {});
    }
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
