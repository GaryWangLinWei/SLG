import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { rmSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const webDir = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const outputDir = resolve(webDir, 'dist-check');
const tscArgs = [
  'tsc',
  resolve(webDir, 'src/utils/comboGemMode.ts'),
  '--target', 'ES2020',
  '--module', 'ESNext',
  '--moduleResolution', 'bundler',
  '--outDir', outputDir,
];

try {
  if (process.platform === 'win32') {
    execFileSync(process.env.ComSpec ?? 'cmd.exe', ['/d', '/s', '/c', 'npx', ...tscArgs], { cwd: webDir, stdio: 'inherit' });
  } else {
    execFileSync('npx', tscArgs, { cwd: webDir, stdio: 'inherit' });
  }

  const { isComboGemActive } = await import(pathToFileURL(resolve(outputDir, 'comboGemMode.js')).href);
  const baseFeatures = { autoSwitchAccount: true, switchMode: 'combo-gem' };

  assert.equal(isComboGemActive(baseFeatures, false), true, 'all conditions met');
  assert.equal(isComboGemActive({ ...baseFeatures, autoSwitchAccount: false }, false), false, 'scheduling disabled');
  assert.equal(isComboGemActive({ ...baseFeatures, switchMode: 'per-round' }, false), false, 'non-combo mode');
  assert.equal(isComboGemActive(baseFeatures, true), false, 'feature locked');

  console.log('combo-gem mode truth table passed');
} finally {
  rmSync(outputDir, { recursive: true, force: true });
}
