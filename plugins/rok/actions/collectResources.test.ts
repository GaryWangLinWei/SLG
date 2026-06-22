import { isInCollectChatZone } from './collectResources';

describe('collectResources 聊天区域过滤', () => {
  it('左下角聊天区域内的点被判定为命中聊天区', () => {
    expect(isInCollectChatZone(400, 850)).toBe(true);
    expect(isInCollectChatZone(0, 794)).toBe(true);
    expect(isInCollectChatZone(814, 900)).toBe(true);
  });

  it('聊天区域外的点不命中', () => {
    expect(isInCollectChatZone(900, 850)).toBe(false); // x 超出
    expect(isInCollectChatZone(400, 700)).toBe(false); // y 在上方
    expect(isInCollectChatZone(800, 100)).toBe(false);
  });
});
