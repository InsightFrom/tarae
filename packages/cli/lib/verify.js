import fs from 'fs-extra';
import path from 'path';
import os from 'os';
import chalk from 'chalk';
import { spawn } from 'child_process';
import { fileURLToPath } from 'url';
import {
  SUPPORTED_AGENTS,
  inferAgentConfigFormat,
  readGlobalConfig,
  resolveAgentConfigPath,
  resolveProjectRoot,
  supportedAgentsText,
} from './config.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function cliVersion() {
  return fs.readJsonSync(path.resolve(__dirname, '../package.json')).version;
}

function pass(label, detail = '') {
  console.log(`${chalk.green('🟢')} ${label}${detail ? chalk.gray(` — ${detail}`) : ''}`);
}

function warn(label, detail = '') {
  console.log(`${chalk.yellow('🟡')} ${label}${detail ? chalk.gray(` — ${detail}`) : ''}`);
}

function fail(label, detail = '') {
  console.log(`${chalk.red('🔴')} ${label}${detail ? chalk.gray(` — ${detail}`) : ''}`);
}

function topaBinaryName() {
  return process.platform === 'win32' ? 'topa.exe' : 'topa';
}

function verifyJsonAgent(agent, configPath, projectRoot) {
  if (!fs.existsSync(configPath)) {
    return { ok: false, detail: `config not found at ${configPath}` };
  }

  let config;
  try {
    config = fs.readJsonSync(configPath);
  } catch (err) {
    return { ok: false, detail: `failed to parse JSON config at ${configPath}: ${err.message}` };
  }

  const tarae = config?.mcpServers?.tarae;
  if (!tarae) {
    return { ok: false, detail: 'tarae MCP entry not found' };
  }

  const linkedRoot = tarae.env?.TARAE_PROJECT_ROOT || tarae.args?.[2];
  if (projectRoot && linkedRoot && path.resolve(linkedRoot) !== path.resolve(projectRoot)) {
    return { ok: false, detail: `linked to ${linkedRoot}` };
  }

  const rootMode = linkedRoot ? `fixed to ${linkedRoot}` : 'project root resolved at MCP call time';
  return { ok: true, detail: `${agent} config linked at ${configPath} (${rootMode})` };
}

function verifyTomlAgent(agent, configPath, projectRoot) {
  if (!fs.existsSync(configPath)) {
    return { ok: false, detail: `config not found at ${configPath}` };
  }

  const content = fs.readFileSync(configPath, 'utf8');
  if (!content.includes('[mcp_servers.tarae]')) {
    return { ok: false, detail: 'tarae MCP table not found' };
  }

  const hasFixedRoot = content.includes('--project-root') || content.includes('TARAE_PROJECT_ROOT');
  if (projectRoot && hasFixedRoot && !content.includes(projectRoot)) {
    return { ok: false, detail: `project root not found in codex config` };
  }

  const rootMode = hasFixedRoot ? 'fixed project root' : 'project root resolved at MCP call time';
  return { ok: true, detail: `${agent} config linked at ${configPath} (${rootMode})` };
}

function verifyAgent(agent, projectRoot, options = {}) {
  const configPath = resolveAgentConfigPath(agent, options);
  const configFormat = inferAgentConfigFormat(agent, configPath, options.configFormat);
  const result = configFormat === 'codex-toml'
    ? verifyTomlAgent(agent, configPath, projectRoot)
    : verifyJsonAgent(agent, configPath, projectRoot);

  if (result.ok) {
    pass(`MCP link (${agent})`, result.detail);
  } else {
    warn(`MCP link (${agent})`, result.detail);
  }
  return result.ok;
}

function sendMcpMessage(child, message) {
  child.stdin.write(`${JSON.stringify(message)}\n`);
}

function waitForMcpResponse(pending, id, timeoutMs) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      pending.delete(id);
      reject(new Error(`MCP response ${id} timed out`));
    }, timeoutMs);

    pending.set(id, {
      resolve: (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      reject: (err) => {
        clearTimeout(timer);
        reject(err);
      },
    });
  });
}

async function checkMcpLifecycleTools({ topaPath, projectRoot }) {
  const args = ['serve', '--project-root', projectRoot];
  const child = spawn(topaPath, args, {
    cwd: projectRoot,
    stdio: ['pipe', 'pipe', 'pipe'],
    env: {
      ...process.env,
      TARAE_PROJECT_ROOT: projectRoot,
      RUST_LOG: 'warn',
    },
  });

  const pending = new Map();
  let buffer = '';
  let stderr = '';

  child.stdout.on('data', (chunk) => {
    buffer += chunk.toString();
    const lines = buffer.split('\n');
    buffer = lines.pop() || '';
    for (const line of lines) {
      if (!line.trim()) {
        continue;
      }
      try {
        const message = JSON.parse(line);
        const waiter = pending.get(message.id);
        if (waiter) {
          pending.delete(message.id);
          if (message.error) {
            waiter.reject(new Error(message.error.message || 'MCP error'));
          } else {
            waiter.resolve(message.result);
          }
        }
      } catch {
        // Ignore non-JSON stdout lines.
      }
    }
  });

  child.stderr.on('data', (chunk) => {
    stderr += chunk.toString();
  });

  try {
    const initialize = waitForMcpResponse(pending, 1, 5000);
    sendMcpMessage(child, {
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: {
        protocolVersion: '2024-11-05',
        capabilities: {},
        clientInfo: { name: 'tarae-cli-verify', version: cliVersion() },
      },
    });
    await initialize;

    sendMcpMessage(child, {
      jsonrpc: '2.0',
      method: 'notifications/initialized',
      params: {},
    });

    const toolsList = waitForMcpResponse(pending, 2, 5000);
    sendMcpMessage(child, {
      jsonrpc: '2.0',
      id: 2,
      method: 'tools/list',
      params: {},
    });
    const result = await toolsList;
    const names = new Set((result.tools || []).map((tool) => tool.name));
    const required = [
      'fetch_past_context',
      'start_session',
      'checkpoint',
      'report_issue',
      'end_session',
      'list_sessions',
      'read_session',
      'search_history',
    ];
    const missing = required.filter((name) => !names.has(name));
    if (missing.length > 0) {
      fail('MCP lifecycle smoke test', `missing tools: ${missing.join(', ')}`);
      return false;
    }

    pass('MCP lifecycle smoke test', required.join(', '));
    return true;
  } catch (err) {
    fail('MCP lifecycle smoke test', `${err.message}${stderr ? ` (${stderr.trim()})` : ''}`);
    return false;
  } finally {
    for (const waiter of pending.values()) {
      waiter.reject(new Error('MCP process closed'));
    }
    pending.clear();
    child.kill('SIGTERM');
  }
}

function checkLocalHistoryWritable(projectRoot) {
  const historyDir = path.join(projectRoot, '.tarae', 'topa', 'sessions');
  try {
    fs.ensureDirSync(historyDir);
    const probePath = path.join(projectRoot, '.tarae', 'topa', '.verify-write-test');
    fs.writeFileSync(probePath, new Date().toISOString(), 'utf8');
    fs.removeSync(probePath);
    pass('Local history writable', path.join(projectRoot, '.tarae', 'topa'));
    return true;
  } catch (err) {
    fail('Local history writable', err.message);
    return false;
  }
}

export async function verifyAction(options = {}) {
  const config = readGlobalConfig();
  const projectRoot = resolveProjectRoot({ projectRoot: options.projectRoot || config.project_root });
  const agent = options.agent || config.default_agent || null;
  const configPath = options.configPath || (!options.agent ? config.agent_config_path : null);
  const configFormat = options.configFormat || (!options.agent ? config.agent_config_format : null);
  const topaPath = path.join(os.homedir(), '.tarae', 'bin', topaBinaryName());

  console.log(chalk.cyan('=== Tarae Verify ===\n'));

  let ok = true;
  if (fs.existsSync(topaPath)) {
    pass('topa binary', topaPath);
  } else {
    fail('topa binary', `${topaPath} not found. Run "tarae init".`);
    ok = false;
  }

  pass('Project root', projectRoot);
  ok = checkLocalHistoryWritable(projectRoot) && ok;

  const agents = agent ? [agent] : SUPPORTED_AGENTS;
  for (const target of agents) {
    const normalized = target.toLowerCase();
    if (!SUPPORTED_AGENTS.includes(normalized) && !configPath) {
      throw new Error(
        `Unsupported agent: ${target}. Supported agents are: ${supportedAgentsText()}. ` +
        'Pass --config-path <path> to verify a custom MCP config.'
      );
    }
    ok = verifyAgent(normalized, projectRoot, {
      ...options,
      configPath,
      configFormat,
    }) && ok;
  }

  if (options.mcpSmoke !== false) {
    ok = await checkMcpLifecycleTools({ topaPath, projectRoot }) && ok;
  } else {
    warn('MCP lifecycle smoke test', 'skipped');
  }

  if (ok) {
    console.log(chalk.bold.green('\nTarae verification passed.'));
  } else if (options.strict) {
    throw new Error('Tarae verification failed.');
  } else {
    console.log(chalk.bold.yellow('\nTarae verification completed with warnings or failures.'));
  }

  return ok;
}
