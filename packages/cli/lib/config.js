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

export function supportedAgentsText() {
  return SUPPORTED_AGENTS.join(', ');
}

export function resolveUserPath(inputPath) {
  if (!inputPath) {
    return null;
  }

  if (inputPath === '~') {
    return os.homedir();
  }

  if (inputPath.startsWith(`~${path.sep}`) || inputPath.startsWith('~/')) {
    return path.join(os.homedir(), inputPath.slice(2));
  }

  return path.resolve(inputPath);
}

export function defaultAgentConfigPath(agent, homeDir = os.homedir()) {
  if (agent === 'cursor') {
    return path.join(
      homeDir,
      'Library/Application Support/Cursor/User/globalStorage/moose.connection-mcp/mcp.json'
    );
  }
  if (agent === 'claude') {
    return path.join(homeDir, '.claude.json');
  }
  if (agent === 'gemini') {
    return path.join(homeDir, '.gemini/config/mcp_config.json');
  }
  if (agent === 'codex') {
    return path.join(homeDir, '.codex', 'config.toml');
  }

  return null;
}

export function inferAgentConfigFormat(agent, configPath, explicitFormat) {
  const requested = explicitFormat ? explicitFormat.toLowerCase() : null;
  if (requested === 'json') {
    return 'json';
  }
  if (requested === 'toml' || requested === 'codex-toml') {
    return 'codex-toml';
  }
  if (requested) {
    throw new Error(`Unsupported config format: ${explicitFormat}. Supported formats are: json, toml`);
  }

  if (agent === 'codex' || path.extname(configPath || '').toLowerCase() === '.toml') {
    return 'codex-toml';
  }

  return 'json';
}

export function resolveAgentConfigPath(agent, options = {}) {
  const configPath = resolveUserPath(options.configPath);
  if (configPath) {
    return configPath;
  }

  const defaultPath = defaultAgentConfigPath(agent);
  if (defaultPath) {
    return defaultPath;
  }

  throw new Error(
    `Unsupported agent: ${agent}. Supported agents are: ${supportedAgentsText()}. ` +
    'Pass --config-path <path> to link a custom MCP config.'
  );
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
