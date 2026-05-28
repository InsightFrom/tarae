import fs from 'fs-extra';
import path from 'path';
import chalk from 'chalk';
import net from 'net';
import { execFileSync } from 'child_process';
import { readGlobalConfig, resolveProjectRoot } from './config.js';

export async function statusAction(options = {}) {
  const config = readGlobalConfig();
  const projectRoot = resolveProjectRoot({ projectRoot: options.projectRoot || config.project_root });
  const topaDir = path.join(projectRoot, '.tarae', 'topa');
  const sessionsDir = path.join(topaDir, 'sessions');
  const sessionCount = fs.existsSync(sessionsDir)
    ? fs.readdirSync(sessionsDir).filter((name) => name.endsWith('.jsonl')).length
    : 0;

  console.log(chalk.cyan('=== Tarae Status ===\n'));
  console.log(chalk.gray(`Project root: ${projectRoot}`));
  console.log(chalk.gray(`Local history: ${topaDir}`));
  console.log(chalk.green(`🟢 local session logs: ${sessionCount}`));
  await printDaemonStatus(projectRoot);
  console.log(chalk.gray('MCP clients start lightweight topa stdio bridge processes. The project daemon owns watching and history writes.'));
  printTopaProcesses();
}

async function printDaemonStatus(projectRoot) {
  const metadataPath = path.join(projectRoot, '.tarae', 'topa', 'runtime', 'server.json');
  if (!fs.existsSync(metadataPath)) {
    console.log(chalk.yellow('🟡 state daemon: not running'));
    return;
  }

  let metadata;
  try {
    metadata = fs.readJsonSync(metadataPath);
  } catch (err) {
    console.log(chalk.red(`🔴 state daemon: invalid runtime metadata (${err.message})`));
    return;
  }

  const health = await probeDaemonHealth(metadata);
  if (health.ok) {
    console.log(chalk.green(`🟢 state daemon: healthy pid=${health.value.pid}`));
    console.log(chalk.gray(`  endpoint: ${metadata.endpoint}`));
    console.log(chalk.gray(`  heartbeat: ${health.value.heartbeat_at}`));
  } else {
    console.log(chalk.yellow(`🟡 state daemon: stale or unreachable (${health.error})`));
    console.log(chalk.gray(`  metadata pid=${metadata.pid || 'unknown'} endpoint=${metadata.endpoint || 'unknown'}`));
  }
}

function probeDaemonHealth(metadata) {
  return new Promise((resolve) => {
    let url;
    try {
      url = new URL(metadata.endpoint);
    } catch {
      resolve({ ok: false, error: 'invalid endpoint' });
      return;
    }

    const body = JSON.stringify({ method: 'health', params: {} });
    const socket = net.createConnection({
      host: url.hostname,
      port: Number(url.port),
    });
    let response = '';
    const done = (value) => {
      socket.destroy();
      resolve(value);
    };
    socket.setTimeout(1500, () => done({ ok: false, error: 'health timeout' }));
    socket.on('error', (err) => done({ ok: false, error: err.message }));
    socket.on('data', (chunk) => {
      response += chunk.toString('utf8');
    });
    socket.on('end', () => {
      const splitAt = response.indexOf('\r\n\r\n');
      if (splitAt < 0) {
        done({ ok: false, error: 'invalid health response' });
        return;
      }
      const head = response.slice(0, splitAt);
      const payload = response.slice(splitAt + 4);
      if (!head.startsWith('HTTP/1.1 200')) {
        done({ ok: false, error: payload.trim() || 'health HTTP error' });
        return;
      }
      try {
        const parsed = JSON.parse(payload);
        if (!parsed.ok) {
          done({ ok: false, error: parsed.error || 'health RPC error' });
          return;
        }
        done({ ok: true, value: parsed.result });
      } catch (err) {
        done({ ok: false, error: err.message });
      }
    });
    socket.write(
      `POST /rpc HTTP/1.1\r\nHost: ${url.host}\r\nAuthorization: Bearer ${metadata.auth_token}\r\nContent-Type: application/json\r\nContent-Length: ${Buffer.byteLength(body)}\r\nConnection: close\r\n\r\n${body}`
    );
  });
}

function printTopaProcesses() {
  const processes = listTopaProcesses();
  if (processes.length === 0) {
    console.log(chalk.yellow('🟡 topa bridge/daemon processes: none detected'));
    return;
  }

  const daemons = processes.filter((proc) => /\bdaemon\b/.test(proc.command));
  const bridges = processes.filter((proc) => /\bserve\b/.test(proc.command));
  console.log(chalk.green(`🟢 topa processes: ${processes.length} (${daemons.length} daemon, ${bridges.length} bridge)`));
  for (const proc of processes) {
    console.log(chalk.gray(`  - pid=${proc.pid} ppid=${proc.ppid} etime=${proc.etime} ${proc.command}`));
  }
  console.log(chalk.gray('Bridge processes exit with MCP stdio connections; the project daemon remains the single resource owner.'));
}

function listTopaProcesses() {
  if (process.platform === 'win32') {
    return [];
  }

  try {
    const execOptions = { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] };
    const pgrep = execFileSync('pgrep', ['-fl', 'topa'], execOptions);
    const pids = pgrep
      .split(/\r?\n/)
      .map((line) => line.trim().split(/\s+/, 1)[0])
      .filter(Boolean);
    if (pids.length === 0) {
      return [];
    }

    const ps = execFileSync(
      'ps',
      ['-o', 'pid=,ppid=,etime=,command=', '-p', pids.join(',')],
      execOptions
    );

    return ps
      .split(/\r?\n/)
      .map((line) => parseTopaProcessLine(line))
      .filter(Boolean)
      .filter((proc) => /(^|\/)topa(\s|$)/.test(proc.command) && /\b(serve|daemon)\b/.test(proc.command));
  } catch {
    return [];
  }
}

function parseTopaProcessLine(line) {
  const match = line.trim().match(/^(\d+)\s+(\d+)\s+(\S+)\s+(.+)$/);
  if (!match) {
    return null;
  }
  return {
    pid: match[1],
    ppid: match[2],
    etime: match[3],
    command: match[4]
  };
}
