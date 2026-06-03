import fs from 'fs-extra';
import path from 'path';
import os from 'os';
import chalk from 'chalk';
import { execFileSync, spawn } from 'child_process';
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
const MIN_LINE_STATS_VERSION = '0.1.5';

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

function taraeShimName() {
  return process.platform === 'win32' ? 'tarae.cmd' : 'tarae';
}

function installedBinDir() {
  return process.env.TARAE_BIN_DIR || path.join(os.homedir(), '.tarae', 'bin');
}

function executableCandidates(name) {
  if (process.platform !== 'win32') {
    return [name];
  }
  const pathExt = process.env.PATHEXT || '.EXE;.CMD;.BAT;.COM';
  return pathExt.split(';').map((ext) => `${name}${ext.toLowerCase()}`);
}

function findOnPath(name) {
  const paths = (process.env.PATH || '').split(path.delimiter).filter(Boolean);
  for (const dir of paths) {
    for (const candidate of executableCandidates(name)) {
      const fullPath = path.join(dir, candidate);
      if (fs.existsSync(fullPath)) {
        return fullPath;
      }
    }
  }
  return null;
}

function samePath(a, b) {
  try {
    return fs.realpathSync(a) === fs.realpathSync(b);
  } catch {
    return path.resolve(a) === path.resolve(b);
  }
}

function commandOutput(command, args) {
  return execFileSync(command, args, {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'ignore'],
  }).trim();
}

function parseSemver(text) {
  const match = String(text || '').match(/(\d+)\.(\d+)\.(\d+)/);
  if (!match) {
    return null;
  }
  return match.slice(1).map((part) => Number.parseInt(part, 10));
}

function isVersionOlder(versionText, minimumText) {
  const version = parseSemver(versionText);
  const minimum = parseSemver(minimumText);
  if (!version || !minimum) {
    return false;
  }
  for (let i = 0; i < 3; i += 1) {
    if (version[i] < minimum[i]) {
      return true;
    }
    if (version[i] > minimum[i]) {
      return false;
    }
  }
  return false;
}

function checkCliPath() {
  const expected = path.join(installedBinDir(), taraeShimName());
  const current = findOnPath('tarae');
  if (fs.existsSync(expected)) {
    try {
      const version = commandOutput(expected, ['--version']);
      pass('tarae CLI shim', `${expected} (${version})`);
      if (isVersionOlder(version, MIN_LINE_STATS_VERSION)) {
        warn('tarae CLI version', `older than ${MIN_LINE_STATS_VERSION}; run "tarae upgrade" or rerun the installer`);
      }
    } catch {
      warn('tarae CLI shim', `${expected} exists but did not run cleanly`);
    }
  } else {
    warn('tarae CLI shim', `${expected} not found`);
  }

  if (!current) {
    warn('PATH tarae', 'not found; call the ~/.tarae/bin/tarae shim explicitly');
    return;
  }

  let detail = current;
  try {
    detail = `${current} (${commandOutput(current, ['--version'])})`;
  } catch {
    detail = `${current} (version check failed)`;
  }

  if (fs.existsSync(expected) && samePath(current, expected)) {
    pass('PATH tarae', detail);
  } else {
    warn('PATH tarae', `${detail}; expected ${expected} to take precedence`);
  }
}

function topaVersion(topaPath) {
  try {
    return commandOutput(topaPath, ['--version']);
  } catch {
    return null;
  }
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
  const identity = [
    tarae.env?.TARAE_AGENT_NAME ? `agent=${tarae.env.TARAE_AGENT_NAME}` : '',
    tarae.env?.TARAE_LINK_ID ? `link=${tarae.env.TARAE_LINK_ID}` : '',
  ].filter(Boolean).join(', ');
  return {
    ok: true,
    detail: `${agent} config linked at ${configPath} (${rootMode}${identity ? `, ${identity}` : ''})`,
  };
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
  const agentName = content.match(/TARAE_AGENT_NAME\s*=\s*"([^"]+)"/)?.[1];
  const linkId = content.match(/TARAE_LINK_ID\s*=\s*"([^"]+)"/)?.[1];
  const identity = [
    agentName ? `agent=${agentName}` : '',
    linkId ? `link=${linkId}` : '',
  ].filter(Boolean).join(', ');
  return {
    ok: true,
    detail: `${agent} config linked at ${configPath} (${rootMode}${identity ? `, ${identity}` : ''})`,
  };
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

function createMcpProbe({ topaPath, projectRoot }) {
  const child = spawn(topaPath, ['serve', '--project-root', projectRoot], {
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

  let nextId = 1;
  const request = (method, params = {}, timeoutMs = 5000) => {
    const id = nextId++;
    const waiter = waitForMcpResponse(pending, id, timeoutMs);
    sendMcpMessage(child, { jsonrpc: '2.0', id, method, params });
    return waiter;
  };
  const notify = (method, params = {}) => {
    sendMcpMessage(child, { jsonrpc: '2.0', method, params });
  };
  const close = () => {
    for (const waiter of pending.values()) {
      waiter.reject(new Error('MCP process closed'));
    }
    pending.clear();
    child.kill('SIGTERM');
  };

  return { child, request, notify, close, stderr: () => stderr };
}

async function initializeProbe(probe) {
  await probe.request('initialize', {
    protocolVersion: '2024-11-05',
    capabilities: {},
    clientInfo: { name: 'tarae-cli-verify', version: cliVersion() },
  });
  probe.notify('notifications/initialized', {});
}

async function checkDaemonReuse({ topaPath }) {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'tarae-verify-'));
  const first = createMcpProbe({ topaPath, projectRoot: tempRoot });
  const second = createMcpProbe({ topaPath, projectRoot: tempRoot });
  try {
    await initializeProbe(first);
    await initializeProbe(second);

    await first.request('tools/call', {
      name: 'start_session',
      arguments: {
        objective: 'verify topa daemon reuse',
        project_root: tempRoot,
        agent_name: 'tarae-cli-verify',
      },
    }, 10000);
    await second.request('tools/call', {
      name: 'start_session',
      arguments: {
        objective: 'verify topa daemon reuse duplicate',
        project_root: tempRoot,
        agent_name: 'tarae-cli-verify',
      },
    }, 10000);

    const metadataPath = path.join(tempRoot, '.tarae', 'topa', 'runtime', 'server.json');
    const metadata = fs.readJsonSync(metadataPath);
    if (!metadata.pid || !metadata.endpoint) {
      fail('Daemon reuse smoke test', 'runtime metadata missing pid or endpoint');
      return false;
    }

    const sessionFiles = fs.readdirSync(path.join(tempRoot, '.tarae', 'topa', 'sessions'))
      .filter((name) => name.endsWith('.jsonl'));
    let sessionStartCount = 0;
    for (const file of sessionFiles) {
      const content = fs.readFileSync(path.join(tempRoot, '.tarae', 'topa', 'sessions', file), 'utf8');
      sessionStartCount += content.split(/\r?\n/).filter((line) => line.includes('"session_start"')).length;
    }
    if (sessionStartCount !== 1) {
      fail('Daemon reuse smoke test', `expected one session_start, found ${sessionStartCount}`);
      return false;
    }

    pass('Daemon reuse smoke test', `single daemon pid=${metadata.pid}`);
    return true;
  } catch (err) {
    fail('Daemon reuse smoke test', err.message);
    return false;
  } finally {
    first.close();
    second.close();
    try {
      execFileSync(topaPath, ['shutdown', '--project-root', tempRoot], {
        stdio: 'ignore',
        env: { ...process.env, TARAE_PROJECT_ROOT: tempRoot },
      });
    } catch {
      // Best-effort cleanup.
    }
    fs.removeSync(tempRoot);
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
  const topaPath = path.join(installedBinDir(), topaBinaryName());

  console.log(chalk.cyan('=== Tarae Verify ===\n'));

  let ok = true;
  checkCliPath();

  if (fs.existsSync(topaPath)) {
    const version = topaVersion(topaPath);
    if (version) {
      pass('topa binary', `${topaPath} (${version})`);
      if (isVersionOlder(version, MIN_LINE_STATS_VERSION)) {
        warn('topa version', `older than ${MIN_LINE_STATS_VERSION}; watcher line-count fixes require an upgrade`);
      }
    } else {
      fail('topa binary', `${topaPath} exists but did not run cleanly`);
      ok = false;
    }
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
    ok = await checkDaemonReuse({ topaPath }) && ok;
  } else {
    warn('MCP lifecycle smoke test', 'skipped');
    warn('Daemon reuse smoke test', 'skipped');
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
