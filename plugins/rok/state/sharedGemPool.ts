export interface SharedGemCoord { x: number; y: number; }

/**
 * 分享矿坐标池：按账号隔离的 FIFO 待处理队列。
 *
 * - 策略 A（一次消耗）：pop 立即出队，任何后续失败都不重入
 * - has 只反映"当前在队列中"，不代表"曾经处理过"
 * - 若主号重新分享同一坐标（外部再次 addUnique），视为新一波分享，允许再次入池采集
 * - 生命周期：从"开始运行"到下次"开始运行"（clearAll 由主循环负责）
 */
class SharedGemPool {
  private byAccount = new Map<string, SharedGemCoord[]>();

  size(accountId: string): number {
    return this.byAccount.get(accountId)?.length ?? 0;
  }

  peek(accountId: string): SharedGemCoord | undefined {
    return this.byAccount.get(accountId)?.[0];
  }

  pop(accountId: string): SharedGemCoord | undefined {
    return this.byAccount.get(accountId)?.shift();
  }

  addUnique(accountId: string, c: SharedGemCoord): boolean {
    const list = this.byAccount.get(accountId) ?? [];
    if (list.some(x => x.x === c.x && x.y === c.y)) return false;
    list.push(c);
    this.byAccount.set(accountId, list);
    return true;
  }

  has(accountId: string, c: SharedGemCoord): boolean {
    const list = this.byAccount.get(accountId);
    if (!list) return false;
    return list.some(x => x.x === c.x && x.y === c.y);
  }

  clearAll(): void {
    this.byAccount.clear();
  }

  clear(accountId: string): void {
    this.byAccount.delete(accountId);
  }

  snapshot(accountId: string): SharedGemCoord[] {
    return [...(this.byAccount.get(accountId) ?? [])];
  }
}

export const sharedGemPool = new SharedGemPool();
