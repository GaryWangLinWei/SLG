import { getCollectResourcesIntervalSeconds } from './homeFeatures';

describe('collect resources interval', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('uses configured minutes with 0.85~1.15 jitter', () => {
    jest.spyOn(Math, 'random').mockReturnValue(0.5);

    expect(getCollectResourcesIntervalSeconds(240)).toBe(240 * 60);
  });

  it('clamps interval to at least 2 minutes before jitter', () => {
    jest.spyOn(Math, 'random').mockReturnValue(0.5);

    expect(getCollectResourcesIntervalSeconds(1)).toBe(2 * 60);
  });

  it('falls back to 240 minutes when value is invalid', () => {
    jest.spyOn(Math, 'random').mockReturnValue(0.5);

    expect(getCollectResourcesIntervalSeconds(Number.NaN)).toBe(240 * 60);
  });
});
