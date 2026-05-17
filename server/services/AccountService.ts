import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';

const CONFIG_DIR = path.join(os.homedir(), '.slg-automation');
const ACCOUNTS_FILE = path.join(CONFIG_DIR, 'accounts.json');
const CONFIGS_DIR = path.join(CONFIG_DIR, 'configs');

export interface Account {
  id: string;
  name: string;
  deviceId: string;
  createdAt: number;
}

function genId(): string {
  return `acc_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}

class AccountService {
  private accounts: Account[] = [];
  private loaded = false;

  private async ensureLoaded(): Promise<void> {
    if (this.loaded) return;
    try {
      const data = await fs.readFile(ACCOUNTS_FILE, 'utf-8');
      this.accounts = JSON.parse(data);
    } catch {
      this.accounts = [];
    }
    this.loaded = true;
  }

  private async persist(): Promise<void> {
    await fs.mkdir(CONFIG_DIR, { recursive: true });
    await fs.writeFile(ACCOUNTS_FILE, JSON.stringify(this.accounts, null, 2), 'utf-8');
  }

  async listAccounts(): Promise<Account[]> {
    await this.ensureLoaded();
    return [...this.accounts];
  }

  async getAccount(id: string): Promise<Account | undefined> {
    await this.ensureLoaded();
    return this.accounts.find(a => a.id === id);
  }

  async createAccount(input: { name: string; deviceId: string }): Promise<Account> {
    await this.ensureLoaded();
    if (!input.name?.trim()) throw new Error('账号名称不能为空');
    if (!input.deviceId?.trim()) throw new Error('设备地址不能为空');

    const account: Account = {
      id: genId(),
      name: input.name.trim(),
      deviceId: input.deviceId.trim(),
      createdAt: Date.now()
    };
    this.accounts.push(account);
    await this.persist();
    return account;
  }

  async updateAccount(id: string, patch: Partial<Pick<Account, 'name' | 'deviceId'>>): Promise<Account> {
    await this.ensureLoaded();
    const account = this.accounts.find(a => a.id === id);
    if (!account) throw new Error(`账号不存在: ${id}`);

    if (patch.name !== undefined) account.name = patch.name.trim();
    if (patch.deviceId !== undefined) account.deviceId = patch.deviceId.trim();

    await this.persist();
    return account;
  }

  async deleteAccount(id: string): Promise<void> {
    await this.ensureLoaded();
    const idx = this.accounts.findIndex(a => a.id === id);
    if (idx === -1) throw new Error(`账号不存在: ${id}`);
    this.accounts.splice(idx, 1);
    await this.persist();

    // 删除对应配置文件
    const configFile = path.join(CONFIGS_DIR, `${id}.json`);
    await fs.unlink(configFile).catch(() => {});
  }
}

export const accountService = new AccountService();
export { CONFIG_DIR, CONFIGS_DIR, ACCOUNTS_FILE };
