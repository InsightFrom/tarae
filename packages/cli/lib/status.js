import fs from 'fs-extra';
import path from 'path';
import chalk from 'chalk';
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
  console.log(chalk.gray('MCP clients start topa as a stdio child process through their MCP configuration.'));
  printTopaProcesses();
}

function printTopaProcesses() {
  const processes = listTopaProcesses();
  if (processes.length === 0) {
    console.log(chalk.yellow('🟡 running topa processes: none detected'));
    return;
  }

  console.log(chalk.green(`🟢 running topa processes: ${processes.length}`));
  for (const proc of processes) {
    console.log(chalk.gray(`  - pid=${proc.pid} ppid=${proc.ppid} etime=${proc.etime} ${proc.command}`));
  }
  console.log(chalk.gray('These processes exit when the MCP client closes the stdio connection, usually after the AI app is restarted or closed.'));
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
      .filter((proc) => /(^|\/)topa(\s|$)/.test(proc.command) && /\bserve\b/.test(proc.command));
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
