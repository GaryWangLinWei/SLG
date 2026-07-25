import * as path from 'path';
import { fileURLToPath } from 'url';

export function isTrustedRunningIntentUrl(
  value: string,
  isDev: boolean,
  webDistPath: string,
): boolean {
  try {
    const url = new URL(value);

    if (isDev) {
      return url.origin === 'http://localhost:5173';
    }

    if (url.protocol !== 'file:') return false;

    const filePath = path.resolve(fileURLToPath(url));
    const distPath = path.resolve(webDistPath);
    const relativePath = path.relative(distPath, filePath);
    return relativePath === '' || (
      !relativePath.startsWith(`..${path.sep}`)
      && relativePath !== '..'
      && !path.isAbsolute(relativePath)
    );
  } catch {
    return false;
  }
}
