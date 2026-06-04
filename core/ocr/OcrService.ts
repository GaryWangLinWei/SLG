import Tesseract from 'tesseract.js';
import { getTraineddataDir } from '../resourcePath';
import sharp from 'sharp';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';

type OcrWorker = Tesseract.Worker;

const LANG_PATH = getTraineddataDir();

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
   * 识别图像中的文本。imagePath 为本地 PNG 文件路径。
   */
  async readText(imagePath: string): Promise<string> {
    const worker = await this.getWorker();
    const { data } = await worker.recognize(imagePath);
    return data.text.trim();
  }

  /**
   * 识别图像中的数字（针对小区域优化）。
   * 自动做灰度化、放大、二值化预处理，限制只识别数字。
   */
  async readDigits(imagePath: string): Promise<string> {
    // Preprocess: grayscale → upscale 3x → threshold → save to temp
    const preprocessed = path.join(os.tmpdir(), `ocr-digits-${Date.now()}.png`);
    try {
      const buf = await sharp(imagePath)
        .grayscale()
        .resize({ width: 90, height: 60, fit: 'fill', kernel: 'lanczos3' })
        .normalize()
        .threshold(128)
        .toBuffer();
      await fs.writeFile(preprocessed, buf);

      const worker = await this.getWorker();
      await worker.setParameters({ tessedit_char_whitelist: '0123456789' });
      const { data } = await worker.recognize(preprocessed);
      await worker.setParameters({ tessedit_char_whitelist: '' }); // reset
      return data.text.trim();
    } finally {
      await fs.unlink(preprocessed).catch(() => {});
    }
  }

  /**
   * 识别图像中的中文文本
   */
  async readChineseText(imagePath: string): Promise<string> {
    const worker = await this.getChineseWorker();
    const { data } = await worker.recognize(imagePath);
    return data.text.trim();
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
