import { parsePackagedEdition } from './edition';

describe('parsePackagedEdition', () => {
  it('accepts main and agent metadata', () => {
    expect(parsePackagedEdition({ id: 'main', updateUrl: 'https://example.com/updates' }).id).toBe('main');
    expect(parsePackagedEdition({ id: 'agent', updateUrl: 'https://example.com/updates/agent' }).id).toBe('agent');
  });

  it('rejects invalid ids and non-https feeds', () => {
    expect(() => parsePackagedEdition({ id: 'dealer', updateUrl: 'https://example.com' })).toThrow();
    expect(() => parsePackagedEdition({ id: 'main', updateUrl: 'http://example.com' })).toThrow();
  });
});
