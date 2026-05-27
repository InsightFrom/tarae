import fs from 'fs-extra';
import path from 'path';
import os from 'os';

export const SUPPORTED_AGENTS = ['cursor', 'claude', 'gemini', 'codex'];

export function taraeHomeDir() {
  return path.join(os.homedir(), '.tarae');
}

export function globalConfigPath() {
  return path.join(taraeHomeDir(), 'config.json');
}

export function readGlobalConfig() {
  const configPath = globalConfigPath();
  if (!fs.existsSync(configPath)) {
    return {};
  }

  try {
    return fs.readJsonSync(configPath);
  } catch {
    return {};
  }
}

export function writeGlobalConfig(nextConfig) {
  const configPath = globalConfigPath();
  fs.ensureDirSync(path.dirname(configPath));
  fs.writeJsonSync(configPath, nextConfig, { spaces: 2 });
  return configPath;
}

export function mergeGlobalConfig(partial) {
  const existing = readGlobalConfig();
  const next = {
    ...existing,
    ...partial,
    updated_at: new Date().toISOString(),
  };
  return { config: next, path: writeGlobalConfig(next) };
}

export function resolveProjectRoot(options = {}) {
  const configured = options?.projectRoot || process.env.TARAE_PROJECT_ROOT || process.cwd();
  const root = path.resolve(configured);

  if (!fs.existsSync(root)) {
    throw new Error(`Project root does not exist: ${root}`);
  }

  if (!fs.statSync(root).isDirectory()) {
    throw new Error(`Project root is not a directory: ${root}`);
  }

  return fs.realpathSync(root);
}

export function defaultProjectName(projectRoot = process.cwd()) {
  return path.basename(path.resolve(projectRoot)) || 'Tarae Project';
}
