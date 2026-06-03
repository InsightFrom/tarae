import fs from 'fs-extra';
import path from 'path';
import os from 'os';
import crypto from 'crypto';
import chalk from 'chalk';
import readline from 'readline/promises';
import { stdin as input, stdout as output } from 'process';
import {
  SUPPORTED_AGENTS,
  defaultAgentConfigPath,
  inferAgentConfigFormat,
  resolveUserPath,
  supportedAgentsText,
} from './config.js';

function tomlString(value) {
  return JSON.stringify(String(value ?? ''));
}

function tomlArray(values) {
  return `[${values.map(tomlString).join(', ')}]`;
}

function resolveProjectRoot(options = {}) {
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

function removeTomlTables(content, tableNames) {
  const targets = new Set(tableNames);
  const lines = content.split(/\r?\n/);
  const kept = [];
  let skipping = false;

  for (const line of lines) {
    const tableMatch = line.match(/^\s*\[([^\]]+)\]\s*$/);
    if (tableMatch) {
      skipping = targets.has(tableMatch[1]);
    }

    if (!skipping) {
      kept.push(line);
    }
  }

  return kept.join('\n').replace(/\s+$/, '');
}

function createFileReport() {
  const entries = [];
  const seen = new Set();

  return {
    record(action, filePath) {
      const resolved = path.resolve(filePath);
      const key = `${action}\0${resolved}`;
      if (seen.has(key)) {
        return;
      }
      seen.add(key);
      entries.push({ action, filePath: resolved });
    },
    print() {
      if (entries.length === 0) {
        return;
      }
      console.log(chalk.cyan('\nMCP files touched:'));
      for (const entry of entries) {
        console.log(chalk.gray(`  - ${entry.action}: ${entry.filePath}`));
      }
    },
  };
}

function backupFile(configPath, report) {
  if (!fs.existsSync(configPath)) {
    return;
  }

  const backupPath = `${configPath}.bak`;
  fs.copySync(configPath, backupPath);
  report?.record('wrote backup', backupPath);

  if (!fs.existsSync(backupPath) || fs.statSync(backupPath).size !== fs.statSync(configPath).size) {
    throw new Error(`Backup validation failed for ${configPath}`);
  }

  console.log(chalk.green(`Backup created successfully: ${backupPath}`));
}

function topaBinaryName() {
  return process.platform === 'win32' ? 'topa.exe' : 'topa';
}

function mcpServerArgs({ projectRoot, fixedProjectRoot }) {
  return fixedProjectRoot ? ['serve', '--project-root', projectRoot] : ['serve'];
}

function sanitizeLinkPart(value) {
  return String(value || 'agent')
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    || 'agent';
}

function defaultLinkId(agent, configPath) {
  const hash = crypto
    .createHash('sha256')
    .update(`${agent}:${path.resolve(configPath)}`)
    .digest('hex')
    .slice(0, 12);
  return `${sanitizeLinkPart(agent)}-${hash}`;
}

function mcpServerEnv({ agent, linkId, projectRoot, fixedProjectRoot }) {
  const env = {
    TARAE_AGENT_NAME: agent,
    TARAE_LINK_ID: linkId,
  };
  if (fixedProjectRoot) {
    env.TARAE_PROJECT_ROOT = projectRoot;
  }
  return env;
}

function linkCodexConfig({ agent, linkId, configPath, topaPath, projectRoot, fixedProjectRoot, report }) {
  console.log(chalk.cyan(`Linking Tarae MCP server to ${agent}...`));
  console.log(chalk.gray(`Config path: ${configPath}`));
  console.log(chalk.gray(`Link id: ${linkId}`));
  if (!fixedProjectRoot) {
    console.log(chalk.gray('Project root mode: resolved at MCP call time'));
  }

  fs.ensureDirSync(path.dirname(configPath));

  let existing = '';
  if (fs.existsSync(configPath)) {
    report.record('read config', configPath);
    backupFile(configPath, report);
    existing = fs.readFileSync(configPath, 'utf8');
  } else {
    console.log(chalk.yellow(`No existing config found at ${configPath}. Creating new file.`));
  }

  const preserved = removeTomlTables(existing, [
    'mcp_servers.tarae',
    'mcp_servers.tarae.env',
  ]);

  const taraeConfig = [
    '[mcp_servers.tarae]',
    `command = ${tomlString(topaPath)}`,
    `args = ${tomlArray(mcpServerArgs({ projectRoot, fixedProjectRoot }))}`,
  ];

  const env = mcpServerEnv({ agent, linkId, projectRoot, fixedProjectRoot });
  taraeConfig.push('', '[mcp_servers.tarae.env]');
  for (const [key, value] of Object.entries(env)) {
    taraeConfig.push(`${key} = ${tomlString(value)}`);
  }

  const nextConfig = `${preserved ? `${preserved}\n\n` : ''}${taraeConfig.join('\n')}\n`;
  fs.writeFileSync(configPath, nextConfig, 'utf8');
  report.record('wrote config', configPath);
  console.log(chalk.green(`Successfully linked Tarae MCP server to ${agent}!`));
}

function linkJsonConfig({ agent, linkId, configPath, topaPath, projectRoot, fixedProjectRoot, report }) {
  console.log(chalk.cyan(`Linking Tarae MCP server to ${agent}...`));
  console.log(chalk.gray(`Config path: ${configPath}`));
  console.log(chalk.gray(`Link id: ${linkId}`));
  if (!fixedProjectRoot) {
    console.log(chalk.gray('Project root mode: resolved at MCP call time'));
  }

  fs.ensureDirSync(path.dirname(configPath));

  let config = { mcpServers: {} };
  if (fs.existsSync(configPath)) {
    report.record('read config', configPath);
    backupFile(configPath, report);
    try {
      config = fs.readJsonSync(configPath);
    } catch (err) {
      console.log(chalk.yellow(`Warning: failed to parse existing config JSON. Overwriting. Error: ${err.message}`));
    }
  } else {
    console.log(chalk.yellow(`No existing config found at ${configPath}. Creating new file.`));
  }

  if (!config.mcpServers) {
    config.mcpServers = {};
  }

  config.mcpServers.tarae = {
    command: topaPath,
    args: mcpServerArgs({ projectRoot, fixedProjectRoot }),
    env: mcpServerEnv({ agent, linkId, projectRoot, fixedProjectRoot }),
    disabled: false
  };

  fs.writeJsonSync(configPath, config, { spaces: 2 });
  report.record('wrote config', configPath);
  console.log(chalk.green(`Successfully linked Tarae MCP server to ${agent}!`));
}

async function promptForConfigPath(agent) {
  if (!process.stdin.isTTY) {
    throw new Error(
      `Unsupported agent: ${agent}. Supported agents are: ${supportedAgentsText()}. ` +
      'Pass --config-path <path> to link a custom MCP config.'
    );
  }

  console.log(chalk.yellow(`Unsupported agent: ${agent}.`));
  console.log(chalk.gray('Enter the MCP config file path to link it as a custom JSON/TOML config.'));

  const rl = readline.createInterface({ input, output });
  try {
    const answer = await rl.question('MCP config path: ');
    const trimmed = answer.trim();
    if (!trimmed) {
      throw new Error('Config path is required for unsupported agents.');
    }
    return resolveUserPath(trimmed);
  } finally {
    rl.close();
  }
}

export async function linkAction(agent, options = {}) {
  const homeDir = os.homedir();
  const topaPath = path.join(homeDir, '.tarae', 'bin', topaBinaryName());
  const projectRoot = resolveProjectRoot(options);
  const report = createFileReport();
  console.log(chalk.gray(`Project root: ${projectRoot}`));

  if (!fs.existsSync(topaPath)) {
    throw new Error(`topa binary not found at ${topaPath}. Please run "tarae init" first!`);
  }

  const targetAgent = agent ? agent.toLowerCase() : 'cursor';
  const supported = SUPPORTED_AGENTS.includes(targetAgent);
  let configPath = resolveUserPath(options.configPath) || defaultAgentConfigPath(targetAgent, homeDir);

  if (!supported && !configPath) {
    configPath = await promptForConfigPath(agent);
  }

  if (!supported) {
    console.log(chalk.yellow(`Unsupported agent: ${agent}. Linking as a custom MCP config.`));
  }

  const configFormat = inferAgentConfigFormat(targetAgent, configPath, options.configFormat);
  const linkId = options.linkId || defaultLinkId(targetAgent, configPath);
  if (configFormat === 'codex-toml') {
    linkCodexConfig({
      agent: targetAgent,
      linkId,
      configPath,
      topaPath,
      projectRoot,
      fixedProjectRoot: options.fixedProjectRoot === true,
      report,
    });
  } else {
    linkJsonConfig({
      agent: targetAgent,
      linkId,
      configPath,
      topaPath,
      projectRoot,
      fixedProjectRoot: options.fixedProjectRoot === true,
      report,
    });
  }

  report.print();
  return {
    agent: targetAgent,
    linkId,
    configPath,
    configFormat,
  };
}
