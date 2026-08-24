import { Vision } from './Vision';

/**
 * 原本这里还有 13 条依赖本机桌面截图（C:\Users\54459\Desktop\Test\*.png）的用例，
 * 实为当时调参用的一次性脚本——裁剪模板、画红框标注置信度、比较识别耗时——
 * 借 jest 当运行器。截图不在仓库里，换机器或清理桌面后必然 ENOENT 全红，
 * 长期掩盖真实回归，故删除。需要复现那类实验时另写脚本，不要放进测试套件。
 */
describe('Vision Template Matching', () => {
  let vision: Vision;

  beforeEach(() => {
    vision = new Vision();
  });

  it('should have findImage method', () => {
    expect(typeof vision.findImage).toBe('function');
  });
});
