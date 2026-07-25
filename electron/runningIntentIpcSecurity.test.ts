import * as path from 'path';
import { isTrustedRunningIntentUrl } from './runningIntentIpcSecurity';

describe('isTrustedRunningIntentUrl', () => {
  test('allows localhost Vite pages only in development', () => {
    expect(isTrustedRunningIntentUrl('http://localhost:5173/', true, 'C:\\app\\web\\dist')).toBe(true);
    expect(isTrustedRunningIntentUrl('http://localhost:5173/settings', true, 'C:\\app\\web\\dist')).toBe(true);
    expect(isTrustedRunningIntentUrl('http://127.0.0.1:5173/', true, 'C:\\app\\web\\dist')).toBe(false);
    expect(isTrustedRunningIntentUrl('http://localhost:5173.evil.test/', true, 'C:\\app\\web\\dist')).toBe(false);
  });

  test('allows only files within web/dist in production', () => {
    const webDistPath = path.resolve('C:\\app\\web\\dist');
    const indexUrl = new URL(`file:///${webDistPath.replace(/\\/g, '/')}/index.html`).href;
    const nestedUrl = new URL(`file:///${webDistPath.replace(/\\/g, '/')}/assets/app.js`).href;
    const outsideUrl = new URL(`file:///${path.resolve('C:\\app\\web\\other.html').replace(/\\/g, '/')}`).href;

    expect(isTrustedRunningIntentUrl(indexUrl, false, webDistPath)).toBe(true);
    expect(isTrustedRunningIntentUrl(nestedUrl, false, webDistPath)).toBe(true);
    expect(isTrustedRunningIntentUrl(outsideUrl, false, webDistPath)).toBe(false);
    expect(isTrustedRunningIntentUrl('https://example.com/', false, webDistPath)).toBe(false);
  });

  test('rejects malformed URLs', () => {
    expect(isTrustedRunningIntentUrl('not a URL', true, 'C:\\app\\web\\dist')).toBe(false);
  });
});
