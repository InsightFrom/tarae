import fs from 'fs-extra';
import path from 'path';
import os from 'os';
import chalk from 'chalk';

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

function backupFile(configPath) {
  if (!fs.existsSync(configPath)) {
    return;
  }

  const backupPath = `${configPath}.bak`;
  fs.copySync(configPath, backupPath);

  if (!fs.existsSync(backupPath) || fs.statSync(backupPath).size !== fs.statSync(configPath).size) {
    throw new Error(`Backup validation failed for ${configPath}`);
  }

  console.log(chalk.green(`Backup created successfully: ${backupPath}`));
}

function topaBinaryName() {
  return process.platform === 'win32' ? 'topa.exe' : 'topa';
}

function linkCodexConfig({ homeDir, topaPath, projectRoot }) {
  const configPath = path.join(homeDir, '.codex', 'config.toml');
  console.log(chalk.cyan('Linking Tarae MCP server to codex...'));
  console.log(chalk.gray(`Config path: ${configPath}`));

  fs.ensureDirSync(path.dirname(configPath));
  backupFile(configPath);

  const existing = fs.existsSync(configPath) ? fs.readFileSync(configPath, 'utf8') : '';
  const preserved = removeTomlTables(existing, [
    'mcp_servers.tarae',
    'mcp_servers.tarae.env',
  ]);

  const taraeConfig = [
    '[mcp_servers.tarae]',
    `command = ${tomlString(topaPath)}`,
    `args = ${tomlArray(['serve', '--project-root', projectRoot])}`,
    '',
    '[mcp_servers.tarae.env]',
    `TARAE_PROJECT_ROOT = ${tomlString(projectRoot)}`,
  ].join('\n');

  const nextConfig = `${preserved ? `${preserved}\n\n` : ''}${taraeConfig}\n`;
  fs.writeFileSync(configPath, nextConfig, 'utf8');
  console.log(chalk.green('Successfully linked Tarae MCP server to codex!'));
}

export async function linkAction(agent, options) {
  const homeDir = os.homedir();
  const topaPath = path.join(homeDir, '.tarae', 'bin', topaBinaryName());
  const projectRoot = resolveProjectRoot(options);
  console.log(chalk.gray(`Project root: ${projectRoot}`));

  if (!fs.existsSync(topaPath)) {
    throw new Error(`topa binary not found at ${topaPath}. Please run "tarae init" first!`);
  }

  const agentsToLink = [];
  if (agent) {
    const lowerAgent = agent.toLowerCase();
    if (lowerAgent === 'cursor') {
      agentsToLink.push('cursor');
    } else if (lowerAgent === 'claude') {
      agentsToLink.push('claude');
    } else if (lowerAgent === 'gemini') {
      agentsToLink.push('gemini');
    } else if (lowerAgent === 'codex') {
      agentsToLink.push('codex');
    } else {
      throw new Error(`Unsupported agent: ${agent}. Supported agents are: cursor, claude, gemini, codex`);
    }
  } else {
    // Default to linking cursor if not specified, since it is the primary E2E target
    agentsToLink.push('cursor');
  }

  for (const targetAgent of agentsToLink) {
    if (targetAgent === 'codex') {
      linkCodexConfig({ homeDir, topaPath, projectRoot });
      continue;
    }

    let configPath = '';
    if (targetAgent === 'cursor') {
      configPath = path.join(
        homeDir,
        'Library/Application Support/Cursor/User/globalStorage/moose.connection-mcp/mcp.json'
      );
    } else if (targetAgent === 'claude') {
      configPath = path.join(homeDir, '.claude.json');
    } else if (targetAgent === 'gemini') {
      configPath = path.join(homeDir, '.gemini/config/mcp_config.json');
    }

    console.log(chalk.cyan(`Linking Tarae MCP server to ${targetAgent}...`));
    console.log(chalk.gray(`Config path: ${configPath}`));

    // Ensure the parent directory exists
    const dir = path.dirname(configPath);
    fs.ensureDirSync(dir);

    // 1. Backup existing config
    if (fs.existsSync(configPath)) {
      backupFile(configPath);
    } else {
      console.log(chalk.yellow(`No existing config found at ${configPath}. Creating new file.`));
    }

    // 2. Read and merge configuration
    let config = { mcpServers: {} };
    if (fs.existsSync(configPath)) {
      try {
        config = fs.readJsonSync(configPath);
      } catch (err) {
        console.log(chalk.yellow(`Warning: failed to parse existing config JSON. Overwriting. Error: ${err.message}`));
      }
    }

    if (!config.mcpServers) {
      config.mcpServers = {};
    }

    config.mcpServers.tarae = {
      command: topaPath,
      args: ['serve', '--project-root', projectRoot],
      env: {
        TARAE_PROJECT_ROOT: projectRoot
      },
      disabled: false
    };

    // 3. Write merged config
    fs.writeJsonSync(configPath, config, { spaces: 2 });
    console.log(chalk.green(`Successfully linked Tarae MCP server to ${targetAgent}!`));
  }
}
