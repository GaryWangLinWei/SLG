import * as path from 'path';

let templatesDir: string | null = null;
let traineddataDir: string | null = null;

export function initResourcePaths(resourcesPath: string): void {
  templatesDir = path.join(resourcesPath, 'templates');
  traineddataDir = path.join(resourcesPath, 'traineddata');
}

export function getTemplatesDir(): string {
  if (templatesDir) return templatesDir;
  return path.join(__dirname, '../plugins/rok/templates');
}

export function getTraineddataDir(): string {
  if (traineddataDir) return traineddataDir;
  return path.join(__dirname, '../traineddata');
}
