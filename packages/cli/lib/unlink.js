import fs from 'fs-extra';
import chalk from 'chalk';
import {
  SUPPORTED_AGENTS,
  inferAgentConfigFormat,
  resolveAgentConfigPath,
  supportedAgentsText,
} from './config.js';

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
  let targets = [];

  if (options.all) {
    targets = SUPPORTED_AGENTS;
  } else if (agent) {
    const normalized = agent.toLowerCase();
    if (!SUPPORTED_AGENTS.includes(normalized) && !options.configPath) {
      throw new Error(
        `Unsupported agent: ${agent}. Supported agents are: ${supportedAgentsText()}. ` +
        'Pass --config-path <path> to unlink a custom MCP config.'
      );
    }
    targets = [normalized];
  } else {
    throw new Error('Specify an agent to unlink, or pass --all.');
  }

  for (const target of targets) {
    const configPath = resolveAgentConfigPath(target, options);
    const configFormat = inferAgentConfigFormat(target, configPath, options.configFormat);
    console.log(chalk.cyan(`Unlinking Tarae MCP server from ${target}...`));
    console.log(chalk.gray(`Config path: ${configPath}`));

    if (configFormat === 'codex-toml') {
      unlinkCodexConfig(configPath);
    } else {
      unlinkJsonConfig(target, configPath);
    }
  }
}
