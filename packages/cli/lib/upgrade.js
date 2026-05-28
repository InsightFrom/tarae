import fs from 'fs-extra';
import path from 'path';
import os from 'os';
import chalk from 'chalk';
import { execFileSync } from 'child_process';
import { resolveProjectRoot, resolveUserPath } from './config.js';

function topaBinaryName() {
  return process.platform === 'win32' ? 'topa.exe' : 'topa';
}

function run(command, args, options = {}) {
  execFileSync(command, args, {
    stdio: 'inherit',
    ...options,
  });
}

function tryRun(command, args, options = {}) {
  try {
    execFileSync(command, args, {
      stdio: options.stdio || 'ignore',
      ...options,
    });
    return true;
  } catch {
    return false;
  }
}

function isGitRepo(dir) {
  return fs.existsSync(path.join(dir, '.git'));
}

function defaultInstallDir() {
  return path.join(os.homedir(), '.tarae', 'src', 'tarae');
}

function defaultBinDir() {
  return path.join(os.homedir(), '.tarae', 'bin');
}

function writeCliShim(binDir, installDir) {
  fs.ensureDirSync(binDir);
  const cliPath = path.join(installDir, 'packages', 'cli', 'bin', 'index.js');

  if (process.platform === 'win32') {
    const ps1Path = path.join(binDir, 'tarae.ps1');
    const cmdPath = path.join(binDir, 'tarae.cmd');
    fs.writeFileSync(ps1Path, `& node "${cliPath}" @args\n`, 'utf8');
    fs.writeFileSync(cmdPath, `@echo off\r\nnode "${cliPath}" %*\r\n`, 'utf8');
    return [ps1Path, cmdPath];
  }

  const shimPath = path.join(binDir, 'tarae');
  fs.writeFileSync(shimPath, `#!/usr/bin/env bash\nexec node "${cliPath}" "$@"\n`, 'utf8');
  fs.chmodSync(shimPath, 0o755);
  return [shimPath];
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

function tagDownloadBase(ref) {
  return /^v\d/.test(ref) ? `https://github.com/InsightFrom/tarae/releases/download/${ref}` : null;
}

export async function upgradeAction(options = {}) {
  const repoUrl = options.repoUrl || process.env.TARAE_REPO_URL || 'https://github.com/InsightFrom/tarae.git';
  const ref = options.ref || process.env.TARAE_REF || 'main';
  const installDir = resolveUserPath(options.installDir || process.env.TARAE_INSTALL_DIR) || defaultInstallDir();
  const binDir = resolveUserPath(options.binDir || process.env.TARAE_BIN_DIR) || defaultBinDir();
  const cliDir = path.join(installDir, 'packages', 'cli');
  const watcherDir = path.join(installDir, 'packages', 'watcher');
  const updatedCli = path.join(cliDir, 'bin', 'index.js');
  const topaPath = path.join(binDir, topaBinaryName());
  const projectRoot = options.projectRoot ? resolveProjectRoot({ projectRoot: options.projectRoot }) : null;

  console.log(chalk.cyan('=== Tarae Upgrade ===\n'));
  console.log(chalk.gray(`Repository: ${repoUrl}`));
  console.log(chalk.gray(`Ref: ${ref}`));
  console.log(chalk.gray(`Install dir: ${installDir}`));
  console.log(chalk.gray(`Bin dir: ${binDir}`));

  if (projectRoot && fs.existsSync(topaPath)) {
    console.log(chalk.blue(`Stopping existing project daemon for ${projectRoot}`));
    tryRun(topaPath, ['shutdown', '--project-root', projectRoot], {
      env: { ...process.env, TARAE_PROJECT_ROOT: projectRoot },
    });
  }

  fs.ensureDirSync(binDir);
  fs.ensureDirSync(path.dirname(installDir));

  if (isGitRepo(installDir)) {
    run('git', ['-C', installDir, 'fetch', '--tags', 'origin']);
    run('git', ['-C', installDir, 'checkout', ref]);
    tryRun('git', ['-C', installDir, 'pull', '--ff-only', 'origin', ref], {
      stdio: 'inherit',
    });
  } else {
    run('git', ['clone', '--branch', ref, repoUrl, installDir]);
  }

  run('npm', ['install', '--omit=dev', '--prefix', cliDir]);

  if (options.buildFromSource) {
    run('cargo', ['build', '--release'], { cwd: watcherDir });
  }

  const env = {
    ...process.env,
    TARAE_BIN_DIR: binDir,
  };
  if (options.buildFromSource) {
    env.TARAE_DEV = 'true';
    delete env.TARAE_FORCE_TOPA_DOWNLOAD;
  } else {
    env.TARAE_DEV = 'false';
    env.TARAE_FORCE_TOPA_DOWNLOAD = 'true';
    const releaseBase = tagDownloadBase(ref);
    if (releaseBase && !env.TARAE_TOPA_DOWNLOAD_BASE_URL) {
      env.TARAE_TOPA_DOWNLOAD_BASE_URL = releaseBase;
    }
  }

  run(process.execPath, [updatedCli, 'init'], { env });
  const shims = writeCliShim(binDir, installDir);
  console.log(chalk.green(`CLI shim updated: ${shims.join(', ')}`));

  const pathTarae = findOnPath('tarae');
  const preferredShim = process.platform === 'win32'
    ? path.join(binDir, 'tarae.cmd')
    : path.join(binDir, 'tarae');
  if (pathTarae && !samePath(pathTarae, preferredShim)) {
    console.log(chalk.yellow(`PATH resolves tarae to ${pathTarae}, not ${preferredShim}`));
    console.log(chalk.yellow(`Put ${binDir} before other tarae installs in PATH, or call ${preferredShim} explicitly.`));
  }

  if (options.skipVerify) {
    console.log(chalk.yellow('\nVerification skipped.'));
  } else {
    const verifyArgs = ['verify'];
    if (options.agent) {
      verifyArgs.push('--agent', options.agent);
    }
    if (options.configPath) {
      verifyArgs.push('--config-path', options.configPath);
    }
    if (options.configFormat) {
      verifyArgs.push('--config-format', options.configFormat);
    }
    if (projectRoot) {
      verifyArgs.push('--project-root', projectRoot);
    }
    if (options.mcpSmoke === false) {
      verifyArgs.push('--no-mcp-smoke');
    }
    run(process.execPath, [updatedCli, ...verifyArgs], { env: { ...process.env, TARAE_BIN_DIR: binDir } });
  }

  console.log(chalk.bold.green('\nTarae upgrade completed.'));
  console.log(chalk.gray('Restart the AI app so existing MCP stdio bridge processes are replaced.'));
}
