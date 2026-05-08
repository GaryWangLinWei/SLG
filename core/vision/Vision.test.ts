import { Vision } from './Vision';

describe('Vision Template Matching', () => {
  let vision: Vision;

  beforeEach(() => {
    vision = new Vision();
  });

  it('should have findImage method', () => {
    expect(typeof vision.findImage).toBe('function');
  });
});
