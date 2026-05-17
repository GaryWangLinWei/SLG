import { AdbDevice } from '../../core/device';
import { accountService } from './AccountService';

class DeviceService {
  private devices = new Map<string, AdbDevice>();

  private async getOrCreateDevice(accountId: string): Promise<AdbDevice> {
    if (!this.devices.has(accountId)) {
      const account = await accountService.getAccount(accountId);
      if (!account) throw new Error(`账号不存在: ${accountId}`);
      this.devices.set(accountId, new AdbDevice(account.deviceId));
    }
    return this.devices.get(accountId)!;
  }

  async connect(accountId: string): Promise<{ connected: boolean; message: string }> {
    try {
      const device = await this.getOrCreateDevice(accountId);
      const connected = await device.connect();
      if (connected) return { connected: true, message: '设备连接成功' };
      return { connected: false, message: '未找到设备，请确保模拟器已启动且 deviceId 正确' };
    } catch (error) {
      return { connected: false, message: `连接失败: ${error}` };
    }
  }

  async disconnect(accountId: string): Promise<{ success: boolean }> {
    const device = this.devices.get(accountId);
    if (device) {
      await device.disconnect();
      this.devices.delete(accountId);
    }
    return { success: true };
  }

  getStatus(accountId: string): { connected: boolean; deviceInfo?: string } {
    const device = this.devices.get(accountId);
    if (device && device.isConnected()) {
      return { connected: true, deviceInfo: device.getDeviceId() };
    }
    return { connected: false };
  }

  async screenshot(accountId: string): Promise<{ success: boolean; data?: string; error?: string }> {
    const device = this.devices.get(accountId);
    if (!device || !device.isConnected()) return { success: false, error: '设备未连接' };
    try {
      const buffer = await device.screenshot();
      return { success: true, data: `data:image/png;base64,${buffer.toString('base64')}` };
    } catch (error) {
      return { success: false, error: String(error) };
    }
  }

  async tap(accountId: string, x: number, y: number): Promise<{ success: boolean; error?: string }> {
    const device = this.devices.get(accountId);
    if (!device || !device.isConnected()) return { success: false, error: '设备未连接' };
    try { await device.tap(x, y); return { success: true }; }
    catch (error) { return { success: false, error: String(error) }; }
  }

  async swipe(accountId: string, x1: number, y1: number, x2: number, y2: number, duration: number): Promise<{ success: boolean; error?: string }> {
    const device = this.devices.get(accountId);
    if (!device || !device.isConnected()) return { success: false, error: '设备未连接' };
    try { await device.swipe(x1, y1, x2, y2, duration); return { success: true }; }
    catch (error) { return { success: false, error: String(error) }; }
  }

  /**
   * 获取已连接的设备实例（供 PluginService 使用）。如未连接，返回 null。
   * 不主动创建 / 连接。
   */
  getDevice(accountId: string): AdbDevice | null {
    const device = this.devices.get(accountId);
    return device && device.isConnected() ? device : null;
  }

  /**
   * 删除账号时清理对应实例
   */
  removeAccount(accountId: string): void {
    const device = this.devices.get(accountId);
    if (device) {
      device.disconnect().catch(() => {});
      this.devices.delete(accountId);
    }
  }
}

export const deviceService = new DeviceService();
