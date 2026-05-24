import Tesseract from 'tesseract.js';
import { getTraineddataDir } from '../resourcePath';

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
