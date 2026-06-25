import { extractSquareModelSize } from './YoloDetector';

describe('YoloDetector model size', () => {
  it('reads square input size from NCHW dimensions', () => {
    expect(extractSquareModelSize([1, 3, 960, 960])).toBe(960);
    expect(extractSquareModelSize([1, 3, 640, 640])).toBe(640);
  });

  it('falls back to 640 when dimensions are dynamic or invalid', () => {
    expect(extractSquareModelSize([1, 3, 'height', 'width'])).toBe(640);
    expect(extractSquareModelSize([1, 3, 960, 640])).toBe(640);
    expect(extractSquareModelSize(undefined)).toBe(640);
  });
});
