import fs from 'fs-extra';
import path from 'path';
import os from 'os';
import chalk from 'chalk';
import { resolveProjectRoot } from './config.js';

function printCheck(ok, label, detail = '') {
  const icon = ok ? chalk.green('🟢') : chalk.yellow('🟡');
  console.log(`${icon} ${label}${detail ? chalk.gray(` — ${detail}`) : ''}`);
}

function topaBinaryName() {
  return process.platform === 'win32' ? 'topa.exe' : 'topa';
}

function checkTopaInstall() {
  const topaPath = path.join(os.homedir(), '.tarae', 'bin', topaBinaryName());
  printCheck(fs.existsSync(topaPath), 'topa binary', topaPath);
}

function checkProjectRoot(options = {}) {
  const root = resolveProjectRoot(options);
  const markers = ['.git', '.taraeignore', 'package.json', 'Cargo.toml', 'pyproject.toml', 'go.mod'];
  const marker = markers.find((name) => fs.existsSync(path.join(root, name)));
  printCheck(Boolean(marker), 'Project root', marker ? `${root} (${marker})` : `${root} has no known project marker`);
  return root;
}

function checkLocalHistory(root) {
  const topaDir = path.join(root, '.tarae', 'topa');
  const sessionsDir = path.join(topaDir, 'sessions');
  fs.ensureDirSync(sessionsDir);
  const sessionCount = fs.existsSync(sessionsDir)
    ? fs.readdirSync(sessionsDir).filter((name) => name.endsWith('.jsonl')).length
    : 0;
  printCheck(true, 'Local history', `${topaDir} (${sessionCount} session logs)`);
}

export async function doctorAction(options = {}) {
  console.log(chalk.cyan('=== Tarae Doctor ===\n'));
  const projectRoot = checkProjectRoot(options);
  checkTopaInstall();
  checkLocalHistory(projectRoot);
}
