import fs from 'fs-extra';
import path from 'path';
import os from 'os';
import chalk from 'chalk';

const SUPPORTED_AGENTS = ['cursor', 'claude', 'gemini', 'codex'];

function backupFile(configPath) {
  if (!fs.existsSync(configPath)) {
    return;
  }

  const backupPath = `${configPath}.bak`;
  fs.copySync(configPath, backupPath);
  console.log(chalk.green(`Backup created successfully: ${backupPath}`));
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

  return `${kept.join('\n').replace(/\s+$/, '')}\n`;
}

function getConfigPath(agent, homeDir) {
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
  throw new Error(`Unsupported agent: ${agent}`);
}

function unlinkJsonConfig(agent, configPath) {
  if (!fs.existsSync(configPath)) {
    console.log(chalk.yellow(`No ${agent} config found at ${configPath}`));
    return;
  }

  backupFile(configPath);
  const config = fs.readJsonSync(configPath);
  if (!config?.mcpServers?.tarae) {
    console.log(chalk.yellow(`No Tarae MCP entry found in ${agent} config.`));
    return;
  }

  delete config.mcpServers.tarae;
  fs.writeJsonSync(configPath, config, { spaces: 2 });
  console.log(chalk.green(`Removed Tarae MCP entry from ${agent}.`));
}

function unlinkCodexConfig(configPath) {
  if (!fs.existsSync(configPath)) {
    console.log(chalk.yellow(`No codex config found at ${configPath}`));
    return;
  }

  backupFile(configPath);
  const existing = fs.readFileSync(configPath, 'utf8');
  const next = removeTomlTables(existing, [
    'mcp_servers.tarae',
    'mcp_servers.tarae.env',
  ]);

  if (next === `${existing.replace(/\s+$/, '')}\n`) {
    console.log(chalk.yellow('No Tarae MCP entry found in codex config.'));
    return;
  }

  fs.writeFileSync(configPath, next, 'utf8');
  console.log(chalk.green('Removed Tarae MCP entry from codex.'));
}

export async function unlinkAction(agent, options = {}) {
  const homeDir = os.homedir();
  let targets = [];

  if (options.all) {
    targets = SUPPORTED_AGENTS;
  } else if (agent) {
    const normalized = agent.toLowerCase();
    if (!SUPPORTED_AGENTS.includes(normalized)) {
      throw new Error(`Unsupported agent: ${agent}. Supported agents are: ${SUPPORTED_AGENTS.join(', ')}`);
    }
    targets = [normalized];
  } else {
    throw new Error('Specify an agent to unlink, or pass --all.');
  }

  for (const target of targets) {
    const configPath = getConfigPath(target, homeDir);
    console.log(chalk.cyan(`Unlinking Tarae MCP server from ${target}...`));
    console.log(chalk.gray(`Config path: ${configPath}`));

    if (target === 'codex') {
      unlinkCodexConfig(configPath);
    } else {
      unlinkJsonConfig(target, configPath);
    }
  }
}
