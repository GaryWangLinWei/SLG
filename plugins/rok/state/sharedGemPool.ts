export interface SharedGemCoord { x: number; y: number; }

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
