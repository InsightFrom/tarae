const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { execFile } = require('child_process');
const vscode = require('vscode');

const AUTO_UPGRADE_STATE_KEY_PREFIX = 'tarae.runtimeUpgrade.lastAutoAttempt.v1';
const DEFAULT_TIMEOUT_MS = 5 * 60 * 1000;

async function upgradeLocalRuntimeAfterExtensionUpdate(context, projectRoot) {
  const autoUpgrade = vscode.workspace
    .getConfiguration('tarae')
    .get('runtime.autoUpgrade', true);

  if (!autoUpgrade) {
    return { upgraded: false, reason: 'disabled' };
  }

  return upgradeLocalRuntime(context, projectRoot, { force: false, notify: true });
}

async function upgradeLocalRuntimeCommand(context, projectRoot) {
  if (!projectRoot) {
    vscode.window.showInformationMessage('Open a workspace folder to upgrade the Tarae local runtime.');
    return { upgraded: false, reason: 'no-project-root' };
  }

  let result;
  try {
    result = await vscode.window.withProgress({
      location: vscode.ProgressLocation.Notification,
      title: 'Upgrading Tarae local runtime',
      cancellable: false
    }, () => upgradeLocalRuntime(context, projectRoot, { force: true }));
  } catch (error) {
    const message = error && error.message ? error.message : String(error);
    vscode.window.showErrorMessage(`Failed to upgrade Tarae local runtime: ${message}`);
    return { upgraded: false, reason: 'failed', message };
  }

  if (result.upgraded) {
    vscode.window.showInformationMessage(`Tarae local runtime upgraded to v${result.targetVersion}.`);
  } else if (result.reason === 'already-current') {
    vscode.window.showInformationMessage(`Tarae local runtime is already v${result.targetVersion}.`);
  } else {
    vscode.window.showWarningMessage(result.message || 'Tarae local runtime upgrade was not run.');
  }

  return result;
}

async function upgradeLocalRuntime(context, projectRoot, options = {}) {
  const targetVersion = context.extension.packageJSON.version || '';
  if (!projectRoot || !targetVersion) {
    return { upgraded: false, reason: 'no-project-root' };
  }

  const runtime = await inspectLocalRuntime(targetVersion);
  if (!runtime.tarae.exists) {
    return {
      upgraded: false,
      reason: 'tarae-not-found',
      targetVersion,
      message: `Tarae CLI not found at ${runtime.tarae.path}. Run the Tarae installer first.`
    };
  }

  if (!runtime.needsUpgrade) {
    return { upgraded: false, reason: 'already-current', targetVersion, runtime };
  }

  const signature = autoAttemptSignature(projectRoot, targetVersion, runtime);
  const stateKey = autoAttemptStateKey(projectRoot);
  const lastAttempt = context.globalState.get(stateKey);
  if (!options.force && lastAttempt && lastAttempt.signature === signature && lastAttempt.status === 'failed') {
    return {
      upgraded: false,
      reason: 'previous-auto-failure',
      targetVersion,
      runtime,
      message: 'Automatic Tarae runtime upgrade already failed for this version. Run "Tarae: Upgrade Local Runtime" to retry.'
    };
  }

  await context.globalState.update(stateKey, {
    signature,
    status: 'running',
    attemptedAt: new Date().toISOString()
  });

  try {
    const result = await runTaraeUpgrade(runtime.tarae.path, targetVersion, projectRoot);
    const upgradedRuntime = await inspectLocalRuntime(targetVersion);
    if (upgradedRuntime.needsUpgrade) {
      throw new Error(versionMismatchMessage(targetVersion, upgradedRuntime));
    }
    await context.globalState.update(stateKey, {
      signature,
      status: 'success',
      attemptedAt: new Date().toISOString(),
      stdout: tail(result.stdout),
      stderr: tail(result.stderr)
    });

    return {
      upgraded: true,
      reason: 'upgraded',
      targetVersion,
      runtime: upgradedRuntime,
      stdout: result.stdout,
      stderr: result.stderr
    };
  } catch (error) {
    await context.globalState.update(stateKey, {
      signature,
      status: 'failed',
      attemptedAt: new Date().toISOString(),
      message: error.message || String(error),
      stdout: tail(error.stdout || ''),
      stderr: tail(error.stderr || '')
    });
    throw error;
  }
}

async function inspectLocalRuntime(targetVersion) {
  const taraePath = resolveTaraePath();
  const topaPath = resolveTopaPath();
  const tarae = await readVersion(taraePath, ['--version']);
  const topa = await readVersion(topaPath, ['--version']);
  const knownVersions = [tarae.version, topa.version].filter(Boolean);
  const hasOlderRuntime = knownVersions.some((version) => compareSemver(version, targetVersion) < 0);
  const hasDifferentRuntime = knownVersions.some((version) => version !== targetVersion);
  const hasMissingRuntime = !tarae.version || !topa.version;
  const hasOnlyNewerRuntime = knownVersions.length > 0
    && knownVersions.every((version) => compareSemver(version, targetVersion) > 0);

  return {
    targetVersion,
    tarae,
    topa,
    needsUpgrade: hasMissingRuntime || (!hasOnlyNewerRuntime && (hasOlderRuntime || hasDifferentRuntime))
  };
}

async function readVersion(commandPath, args) {
  if (!commandPath || !fs.existsSync(commandPath)) {
    return { path: commandPath, exists: false, version: '', raw: '' };
  }

  try {
    const result = await execFileAsync(commandPath, args, {
      timeout: 10000,
      maxBuffer: 64 * 1024
    });
    const raw = `${result.stdout || ''}${result.stderr || ''}`.trim();
    return {
      path: commandPath,
      exists: true,
      version: extractSemver(raw),
      raw
    };
  } catch (error) {
    return {
      path: commandPath,
      exists: true,
      version: '',
      raw: `${error.stdout || ''}${error.stderr || ''}`.trim(),
      error: error.message || String(error)
    };
  }
}

function runTaraeUpgrade(taraePath, targetVersion, projectRoot) {
  return execFileAsync(
    taraePath,
    ['upgrade', '--ref', `v${targetVersion}`, '--project-root', projectRoot, '--no-mcp-smoke'],
    {
      env: {
        ...process.env,
        TARAE_PROJECT_ROOT: projectRoot
      },
      timeout: DEFAULT_TIMEOUT_MS,
      maxBuffer: 1024 * 1024
    }
  );
}

function resolveTaraePath() {
  const binDir = path.join(os.homedir(), '.tarae', 'bin');
  if (process.platform === 'win32') {
    const cmdPath = path.join(binDir, 'tarae.cmd');
    if (fs.existsSync(cmdPath)) {
      return cmdPath;
    }
    return path.join(binDir, 'tarae.ps1');
  }
  return path.join(binDir, 'tarae');
}

function resolveTopaPath() {
  const binaryName = process.platform === 'win32' ? 'topa.exe' : 'topa';
  return path.join(os.homedir(), '.tarae', 'bin', binaryName);
}

function execFileAsync(command, args, options) {
  const invocation = commandInvocation(command, args);
  return new Promise((resolve, reject) => {
    execFile(invocation.command, invocation.args, options, (error, stdout, stderr) => {
      if (error) {
        error.stdout = stdout;
        error.stderr = stderr;
        reject(error);
        return;
      }
      resolve({ stdout, stderr });
    });
  });
}

function commandInvocation(command, args) {
  if (process.platform === 'win32' && /\.(cmd|bat)$/i.test(command)) {
    return {
      command: process.env.ComSpec || 'cmd.exe',
      args: ['/d', '/s', '/c', [quoteCmdArg(command), ...args.map(quoteCmdArg)].join(' ')]
    };
  }
  return { command, args };
}

function quoteCmdArg(value) {
  return `"${String(value).replace(/"/g, '\\"')}"`;
}

function extractSemver(value) {
  const match = String(value || '').match(/\b(\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?)\b/);
  return match ? match[1] : '';
}

function compareSemver(left, right) {
  const leftParts = parseSemver(left);
  const rightParts = parseSemver(right);
  for (let index = 0; index < 3; index += 1) {
    if (leftParts[index] < rightParts[index]) {
      return -1;
    }
    if (leftParts[index] > rightParts[index]) {
      return 1;
    }
  }
  return 0;
}

function parseSemver(value) {
  const match = String(value || '').match(/^(\d+)\.(\d+)\.(\d+)/);
  if (!match) {
    return [0, 0, 0];
  }
  return match.slice(1, 4).map((part) => Number.parseInt(part, 10));
}

function autoAttemptSignature(projectRoot, targetVersion, runtime) {
  return [
    projectRoot,
    targetVersion,
    runtime.tarae.version || runtime.tarae.error || 'unknown-tarae',
    runtime.topa.version || runtime.topa.error || 'unknown-topa'
  ].join('|');
}

function autoAttemptStateKey(projectRoot) {
  const digest = crypto.createHash('sha256').update(projectRoot || '').digest('hex');
  return `${AUTO_UPGRADE_STATE_KEY_PREFIX}.${digest}`;
}

function versionMismatchMessage(targetVersion, runtime) {
  const taraeVersion = runtime.tarae.version || runtime.tarae.error || 'unknown';
  const topaVersion = runtime.topa.version || runtime.topa.error || 'unknown';
  return `Tarae runtime upgrade finished but versions do not match v${targetVersion} (tarae=${taraeVersion}, topa=${topaVersion}).`;
}

function tail(value) {
  const text = String(value || '').trim();
  return text.length > 2000 ? text.slice(-2000) : text;
}

module.exports = {
  inspectLocalRuntime,
  resolveTaraePath,
  resolveTopaPath,
  upgradeLocalRuntimeAfterExtensionUpdate,
  upgradeLocalRuntimeCommand
};
