import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { getEdition } from './edition-config.mjs';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

export async function createBuildPlan(version) {
  return Promise.all(['main', 'agent'].map(async (name) => {
    const edition = await getEdition(name);
    return {
      edition: edition.id,
      env: { VITE_APP_EDITION: edition.id },
      metadata: { id: edition.id, updateUrl: edition.updateUrl },
      outputDir: edition.outputDir,
      artifactName: edition.artifactName.replace('${version}', version),
      artifactNameTemplate: edition.artifactName,
      updateUrl: edition.updateUrl,
    };
  }));
}

function run(command, args, env) {
  const options = { cwd: rootDir, stdio: 'inherit', env: { ...process.env, ...env } };
  const result = process.platform === 'win32'
    ? spawnSync(process.env.ComSpec || 'cmd.exe', ['/d', '/s', '/c', `${command} ${args.map((arg) => /\s/.test(String(arg)) ? `"${String(arg).replaceAll('"', '\\"')}"` : String(arg)).join(' ')}`], options)
    : spawnSync(command, args, options);
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${command} ${args.join(' ')} failed with exit code ${result.status}`);
}

function safeClean(outputDir) {
  const releaseDir = path.resolve(rootDir, 'release');
  const target = path.resolve(rootDir, outputDir);
  if (path.dirname(target) !== releaseDir) throw new Error(`Refusing to clean outside release directory: ${target}`);
  fs.rmSync(target, { recursive: true, force: true });
}

function verify(step) {
  const output = path.resolve(rootDir, step.outputDir);
  for (const file of [step.artifactName, `${step.artifactName}.blockmap`, 'latest.yml']) {
    if (!fs.existsSync(path.join(output, file))) throw new Error(`Missing build artifact: ${path.join(output, file)}`);
  }
}

export async function buildEditions(version) {
  for (const step of await createBuildPlan(version)) {
    safeClean(step.outputDir);
    run('npm', ['--prefix', 'web', 'run', 'build'], step.env);
    run('npx', ['tsc'], step.env);
    fs.cpSync(path.join(rootDir, 'assets', 'vcredist'), path.join(rootDir, 'node_modules', 'onnxruntime-node', 'bin', 'napi-v6', 'win32', 'x64'), { recursive: true });
    for (const [source, target] of [['assets', 'dist/assets'], ['plugins/rok/templates', 'dist/plugins/rok/templates'], ['plugins/rok/models', 'dist/plugins/rok/models']]) {
      fs.cpSync(path.join(rootDir, source), path.join(rootDir, target), { recursive: true });
    }
    fs.writeFileSync(path.join(rootDir, 'dist', 'app-edition.json'), `${JSON.stringify(step.metadata, null, 2)}\n`);
    const builderCli = path.join(rootDir, 'node_modules', 'electron-builder', 'cli.js');
    const builderResult = spawnSync(process.execPath, [builderCli, '--win', `--config.directories.output=${step.outputDir}`, `--config.win.artifactName=${step.artifactNameTemplate}`, `--config.publish.url=${step.updateUrl}`], {
      cwd: rootDir,
      stdio: 'inherit',
      env: { ...process.env, ...step.env },
    });
    if (builderResult.error) throw builderResult.error;
    if (builderResult.status !== 0) throw new Error(`electron-builder failed with exit code ${builderResult.status}`);
    verify(step);
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(rootDir, 'package.json'), 'utf8'));
    await buildEditions(pkg.version);
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  }
}
