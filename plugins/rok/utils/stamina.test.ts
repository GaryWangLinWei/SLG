import { classifyStaminaColor } from './stamina';

describe('classifyStaminaColor', () => {
  it('绿色通道：G 明显大于 R 和 B', () => {
    expect(classifyStaminaColor(80, 180, 90)).toBe('green');
  });
  it('黄色通道：R/G 都高且接近，B 低', () => {
    expect(classifyStaminaColor(180, 160, 80)).toBe('yellow');
  });
  it('其他返回 unknown', () => {
    expect(classifyStaminaColor(50, 50, 50)).toBe('unknown');
  });
});
