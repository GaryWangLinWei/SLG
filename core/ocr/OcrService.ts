import Tesseract from 'tesseract.js';

type OcrWorker = Tesseract.Worker;

class OcrService {
  private worker: OcrWorker | null = null;

  private async getWorker(): Promise<OcrWorker> {
    if (!this.worker) {
      this.worker = await Tesseract.createWorker('eng');
    }
    return this.worker;
  }

  /**
   * 识别图像中的文本。imagePath 为本地 PNG 文件路径。
   */
  async readText(imagePath: string): Promise<string> {
    const worker = await this.getWorker();
    const { data } = await worker.recognize(imagePath);
    return data.text.trim();
  }

  async destroy(): Promise<void> {
    if (this.worker) {
      await this.worker.terminate();
      this.worker = null;
    }
  }
}

export const ocrService = new OcrService();
