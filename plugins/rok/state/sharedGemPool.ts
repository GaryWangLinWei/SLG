export interface SharedGemCoord { x: number; y: number; }

/**
 * 分享矿坐标池：按账号隔离的 FIFO 待处理队列。
 *
 * - 策略 A（一次消耗）：pop 立即出队，任何后续失败都不重入
 * - 已消耗集合 consumed：pop 出去的坐标记入；addUnique 会先检查 consumed，
 *   防止 collectSharedGemCoords 把已采集过的坐标当新矿重新入池
 * - has 只反映"当前在队列中"，不代表"曾经处理过"
 * - 生命周期：从"开始运行"到下次"开始运行"（clearAll 由主循环负责，pool + consumed 同时清）
 */
class SharedGemPool {
  private byAccount = new Map<string, SharedGemCoord[]>();
  private consumed = new Map<string, Set<string>>();

  private key(c: SharedGemCoord): string { return `${c.x},${c.y}`; }

  size(accountId: string): number {
    return this.byAccount.get(accountId)?.length ?? 0;
  }

  peek(accountId: string): SharedGemCoord | undefined {
    return this.byAccount.get(accountId)?.[0];
  }

  pop(accountId: string): SharedGemCoord | undefined {
    const c = this.byAccount.get(accountId)?.shift();
    if (c) {
      const s = this.consumed.get(accountId) ?? new Set<string>();
      s.add(this.key(c));
      this.consumed.set(accountId, s);
    }
    return c;
  }

  /** 按索引移除并返回；同 pop 一样计入 consumed。用于按最近距离挑取而非 FIFO。 */
  removeAt(accountId: string, index: number): SharedGemCoord | undefined {
    const list = this.byAccount.get(accountId);
    if (!list || index < 0 || index >= list.length) return undefined;
    const [c] = list.splice(index, 1);
    const s = this.consumed.get(accountId) ?? new Set<string>();
    s.add(this.key(c));
    this.consumed.set(accountId, s);
    return c;
  }

  addUnique(accountId: string, c: SharedGemCoord): boolean {
    // 已消耗过的坐标不再入池
    if (this.consumed.get(accountId)?.has(this.key(c))) return false;
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
    this.consumed.clear();
  }

  clear(accountId: string): void {
    this.byAccount.delete(accountId);
    this.consumed.delete(accountId);
  }

  snapshot(accountId: string): SharedGemCoord[] {
    return [...(this.byAccount.get(accountId) ?? [])];
  }
}

export const sharedGemPool = new SharedGemPool();
