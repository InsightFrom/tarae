const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFile } = require('child_process');
const vscode = require('vscode');

const LAST_ACTIVATED_VERSION_KEY = 'tarae.lastActivatedExtensionVersion';

async function restartProjectDaemonAfterUpdate(context, projectRoot) {
  const currentVersion = context.extension.packageJSON.version || '';
  const previousVersion = context.globalState.get(LAST_ACTIVATED_VERSION_KEY, '');

  if (!projectRoot || !currentVersion) {
    return { restarted: false, reason: 'no-project-root' };
  }

  if (previousVersion === currentVersion) {
    return { restarted: false, reason: 'not-an-update' };
  }

  if (!previousVersion && !hasRuntimeMetadata(projectRoot)) {
    await context.globalState.update(LAST_ACTIVATED_VERSION_KEY, currentVersion);
    return { restarted: false, reason: 'first-activation-without-runtime' };
  }

  const result = await restartProjectDaemon(projectRoot, {
    reason: previousVersion
      ? `extension update ${previousVersion} -> ${currentVersion}`
      : `extension activation ${currentVersion} with existing runtime metadata`
  });
  await context.globalState.update(LAST_ACTIVATED_VERSION_KEY, currentVersion);
  return result;
}

async function restartProjectDaemon(projectRoot, options = {}) {
  const topaPath = resolveTopaPath();
  if (!fs.existsSync(topaPath)) {
    return {
      restarted: false,
      reason: 'topa-not-found',
      message: `topa binary not found at ${topaPath}`
    };
  }

  const result = await execFileAsync(topaPath, ['shutdown', '--project-root', projectRoot], {
    env: {
      ...process.env,
      TARAE_PROJECT_ROOT: projectRoot
    },
    timeout: 10000
  });

  return {
    restarted: true,
    reason: options.reason || 'manual',
    command: `${topaPath} shutdown --project-root ${projectRoot}`,
    stdout: result.stdout.trim(),
    stderr: result.stderr.trim()
  };
}

async function restartProjectDaemonCommand(projectRoot) {
  if (!projectRoot) {
    vscode.window.showInformationMessage('Open a workspace folder to restart the Tarae topa daemon.');
    return null;
  }

  try {
    const result = await restartProjectDaemon(projectRoot, { reason: 'manual command' });
    if (result.restarted) {
      vscode.window.showInformationMessage(result.stdout || 'Tarae topa daemon restart requested for this workspace.');
    } else {
      vscode.window.showWarningMessage(result.message || 'Tarae topa daemon restart was not run.');
    }
    return result;
  } catch (error) {
    const message = error && error.message ? error.message : String(error);
    vscode.window.showErrorMessage(`Failed to restart Tarae topa daemon: ${message}`);
    return null;
  }
}

function resolveTopaPath() {
  const binaryName = process.platform === 'win32' ? 'topa.exe' : 'topa';
  return path.join(os.homedir(), '.tarae', 'bin', binaryName);
}

function hasRuntimeMetadata(projectRoot) {
  return fs.existsSync(path.join(projectRoot, '.tarae', 'topa', 'runtime', 'server.json'));
}

function execFileAsync(command, args, options) {
  return new Promise((resolve, reject) => {
    execFile(command, args, options, (error, stdout, stderr) => {
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

module.exports = {
  hasRuntimeMetadata,
  restartProjectDaemon,
  restartProjectDaemonAfterUpdate,
  restartProjectDaemonCommand,
  resolveTopaPath
};
