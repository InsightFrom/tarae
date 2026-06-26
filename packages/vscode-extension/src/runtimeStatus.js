const fs = require('fs');
const http = require('http');
const https = require('https');
const os = require('os');
const path = require('path');
const { execFile } = require('child_process');

const CACHE_TTL_MS = 2500;
const COMMAND_TIMEOUT_MS = 5000;
const HEALTH_TIMEOUT_MS = 1500;
const MAX_RESPONSE_BYTES = 1024 * 1024;

let cachedStatus = null;

async function readRuntimeStatus(projectRoot, options = {}) {
  const targetVersion = options.targetVersion || '';
  const cacheKey = `${projectRoot || ''}\n${targetVersion}`;
  const now = Date.now();
  if (!options.force && cachedStatus && cachedStatus.cacheKey === cacheKey && cachedStatus.expiresAt > now) {
    return cachedStatus.value;
  }

  let value;
  try {
    value = await collectRuntimeStatus(projectRoot, targetVersion);
  } catch (error) {
    value = runtimeStatusFailure(projectRoot, targetVersion, error);
  }

  cachedStatus = {
    cacheKey,
    expiresAt: now + CACHE_TTL_MS,
    value
  };
  return value;
}

async function collectRuntimeStatus(projectRoot, targetVersion) {
  const taraePath = resolveTaraePath();
  const topaPath = resolveTopaPath();
  const [tarae, topa, processes, daemon] = await Promise.all([
    readBinaryStatus('tarae', taraePath),
    readBinaryStatus('topa', topaPath),
    readProcessSummary(),
    readDaemonStatus(projectRoot)
  ]);

  const taraeStatus = {
    ...tarae,
    running: processes.tarae.count > 0,
    processCount: processes.tarae.count,
    versionState: binaryVersionState(tarae.version, targetVersion)
  };
  const topaStatus = {
    ...topa,
    running: processes.topa.count > 0,
    processCount: processes.topa.count,
    daemonCount: processes.topa.daemonCount,
    bridgeCount: processes.topa.bridgeCount,
    versionState: binaryVersionState(topa.version, targetVersion)
  };

  return {
    checkedAt: new Date().toISOString(),
    processScanSupported: processes.supported,
    processScanError: processes.error || '',
    targetVersion,
    tarae: taraeStatus,
    topa: topaStatus,
    version: runtimeVersionStatus(taraeStatus, topaStatus, targetVersion),
    daemon
  };
}

function runtimeStatusFailure(projectRoot, targetVersion, error) {
  const message = shortError(error) || 'Runtime status check failed.';
  const tarae = failedBinaryStatus('tarae', resolveTaraePath(), targetVersion, message);
  const topa = {
    ...failedBinaryStatus('topa', resolveTopaPath(), targetVersion, message),
    daemonCount: 0,
    bridgeCount: 0
  };
  return {
    checkedAt: new Date().toISOString(),
    processScanSupported: false,
    processScanError: message,
    targetVersion,
    tarae,
    topa,
    version: runtimeVersionStatus(tarae, topa, targetVersion),
    daemon: {
      ...baseDaemonStatus(projectRoot),
      state: 'error',
      detail: message
    }
  };
}

function failedBinaryStatus(name, commandPath, targetVersion, message) {
  return {
    name,
    path: commandPath,
    exists: Boolean(commandPath && fs.existsSync(commandPath)),
    version: '',
    raw: '',
    error: message,
    running: false,
    processCount: 0,
    versionState: binaryVersionState('', targetVersion)
  };
}

async function readBinaryStatus(name, commandPath) {
  const status = {
    name,
    path: commandPath,
    exists: Boolean(commandPath && fs.existsSync(commandPath)),
    version: '',
    raw: '',
    error: ''
  };
  if (!status.exists) {
    return status;
  }

  try {
    const result = await execFileAsync(commandPath, ['--version'], {
      timeout: COMMAND_TIMEOUT_MS,
      maxBuffer: 64 * 1024
    });
    const raw = `${result.stdout || ''}${result.stderr || ''}`.trim();
    status.raw = raw;
    status.version = extractSemver(raw);
  } catch (error) {
    status.raw = `${error.stdout || ''}${error.stderr || ''}`.trim();
    status.error = shortError(error);
  }
  return status;
}

async function readProcessSummary() {
  const empty = {
    supported: process.platform !== 'win32',
    error: process.platform === 'win32' ? 'Process scan is not available on Windows yet.' : '',
    tarae: { count: 0 },
    topa: { count: 0, daemonCount: 0, bridgeCount: 0 }
  };

  if (!empty.supported) {
    return empty;
  }

  try {
    const result = await execFileAsync('ps', ['-ax', '-o', 'pid=', '-o', 'command='], {
      timeout: COMMAND_TIMEOUT_MS,
      maxBuffer: 1024 * 1024
    });
    const taraePath = resolveTaraePath();
    const topaPath = resolveTopaPath();
    for (const line of String(result.stdout || '').split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed) {
        continue;
      }
      const match = trimmed.match(/^(\d+)\s+(.+)$/);
      if (!match) {
        continue;
      }
      const command = match[2];
      const processType = classifyProcess(command, { taraePath, topaPath });
      if (processType === 'tarae') {
        empty.tarae.count += 1;
      } else if (processType === 'topa-daemon') {
        empty.topa.count += 1;
        empty.topa.daemonCount += 1;
      } else if (processType === 'topa-bridge') {
        empty.topa.count += 1;
        empty.topa.bridgeCount += 1;
      } else if (processType === 'topa') {
        empty.topa.count += 1;
      }
    }
  } catch (error) {
    empty.supported = false;
    empty.error = shortError(error);
  }
  return empty;
}

async function readDaemonStatus(projectRoot) {
  const status = baseDaemonStatus(projectRoot);
  if (!projectRoot) {
    status.state = 'no-workspace';
    status.detail = 'No workspace folder is open.';
    return status;
  }

  const metadataPath = status.metadataPath;
  if (!fs.existsSync(metadataPath)) {
    status.state = 'stopped';
    status.detail = 'No runtime metadata found for this workspace.';
    return status;
  }

  status.metadataExists = true;
  let metadata;
  try {
    metadata = JSON.parse(fs.readFileSync(metadataPath, 'utf8'));
  } catch (error) {
    status.state = 'invalid-metadata';
    status.detail = `Failed to read runtime metadata: ${shortError(error)}`;
    return status;
  }

  status.pid = metadata.pid || 0;
  status.endpoint = typeof metadata.endpoint === 'string' ? metadata.endpoint : '';
  status.version = typeof metadata.version === 'string' ? metadata.version : '';
  status.startedAt = typeof metadata.started_at === 'string' ? metadata.started_at : '';
  status.heartbeatAt = typeof metadata.heartbeat_at === 'string' ? metadata.heartbeat_at : '';
  status.metadataProjectRoot = typeof metadata.project_root === 'string' ? metadata.project_root : '';

  if (!status.endpoint || !metadata.auth_token) {
    status.state = 'invalid-metadata';
    status.detail = 'Runtime metadata is missing endpoint or auth token.';
    return status;
  }

  try {
    const health = await callDaemonHealth(status.endpoint, metadata.auth_token);
    status.health = sanitizeHealth(health);
    status.healthy = daemonMatches(projectRoot, metadata, health);
    status.state = status.healthy ? 'healthy' : 'mismatch';
    status.detail = status.healthy
      ? 'Current workspace daemon is healthy.'
      : 'Runtime metadata does not match the health response.';
  } catch (error) {
    status.state = 'unreachable';
    status.detail = `Health check failed: ${shortError(error)}`;
  }
  return status;
}

function baseDaemonStatus(projectRoot) {
  return {
    projectRoot: projectRoot || '',
    metadataPath: projectRoot ? path.join(projectRoot, '.tarae', 'topa', 'runtime', 'server.json') : '',
    metadataExists: false,
    healthy: false,
    state: 'unknown',
    detail: '',
    pid: 0,
    endpoint: '',
    version: '',
    startedAt: '',
    heartbeatAt: '',
    metadataProjectRoot: '',
    health: null
  };
}

function callDaemonHealth(endpoint, authToken) {
  return new Promise((resolve, reject) => {
    let endpointUrl;
    try {
      endpointUrl = new URL('/rpc', endpoint);
    } catch (error) {
      reject(new Error(`Invalid daemon endpoint: ${shortError(error)}`));
      return;
    }

    const client = endpointUrl.protocol === 'https:' ? https : http;
    const body = JSON.stringify({ method: 'health', params: {} });
    const request = client.request({
      hostname: endpointUrl.hostname,
      port: endpointUrl.port,
      path: endpointUrl.pathname,
      method: 'POST',
      headers: {
        Authorization: `Bearer ${authToken}`,
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body),
        Connection: 'close'
      },
      timeout: HEALTH_TIMEOUT_MS
    }, (response) => {
      const chunks = [];
      let received = 0;
      response.on('data', (chunk) => {
        received += chunk.length;
        if (received > MAX_RESPONSE_BYTES) {
          request.destroy(new Error('Daemon health response exceeded size limit.'));
          return;
        }
        chunks.push(chunk);
      });
      response.on('end', () => {
        const responseBody = Buffer.concat(chunks).toString('utf8');
        if (response.statusCode !== 200) {
          reject(new Error(responseBody || `HTTP ${response.statusCode}`));
          return;
        }
        try {
          const parsed = JSON.parse(responseBody);
          if (!parsed.ok) {
            reject(new Error(parsed.error || 'Daemon health RPC failed.'));
            return;
          }
          resolve(parsed.result || {});
        } catch (error) {
          reject(error);
        }
      });
    });

    request.on('timeout', () => {
      request.destroy(new Error(`Timed out after ${HEALTH_TIMEOUT_MS}ms.`));
    });
    request.on('error', reject);
    request.write(body);
    request.end();
  });
}

function daemonMatches(projectRoot, metadata, health) {
  return Number(metadata.pid) === Number(health.pid)
    && String(metadata.version || '') === String(health.version || '')
    && normalizePath(metadata.project_root) === normalizePath(projectRoot)
    && normalizePath(health.project_root) === normalizePath(projectRoot);
}

function sanitizeHealth(health) {
  return {
    pid: Number(health.pid || 0),
    projectRoot: typeof health.project_root === 'string' ? health.project_root : '',
    version: typeof health.version === 'string' ? health.version : '',
    startedAt: typeof health.started_at === 'string' ? health.started_at : '',
    heartbeatAt: typeof health.heartbeat_at === 'string' ? health.heartbeat_at : ''
  };
}

function classifyProcess(command, paths) {
  const normalized = String(command || '');
  if (/\s--version(\s|$)/i.test(normalized)) {
    return '';
  }
  if (startsWithCommandPath(normalized, paths.topaPath)) {
    if (/\sdaemon(\s|$)/i.test(normalized)) {
      return 'topa-daemon';
    }
    if (/\sserve(\s|$)/i.test(normalized)) {
      return 'topa-bridge';
    }
    return 'topa';
  }

  if (startsWithCommandPath(normalized, paths.taraePath) || startsWithNodeCli(normalized)) {
    return 'tarae';
  }
  return '';
}

function startsWithCommandPath(command, commandPath) {
  if (!command || !commandPath) {
    return false;
  }
  return command === commandPath || command.startsWith(`${commandPath} `);
}

function startsWithNodeCli(command) {
  const firstToken = command.trim().split(/\s+/, 1)[0] || '';
  const executable = path.basename(firstToken).toLowerCase();
  return /^node(?:\.exe)?$/.test(executable)
    && /packages[/\\]cli[/\\]bin[/\\]index\.js(?:\s|$)/i.test(command);
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

function runtimeVersionStatus(tarae, topa, targetVersion) {
  if (!targetVersion) {
    return {
      targetVersion: '',
      status: 'unknown',
      needsUpdate: false,
      detail: 'Extension version is unknown.'
    };
  }

  const states = [tarae.versionState, topa.versionState];
  const status = states.includes('missing') || states.includes('update-needed')
    ? 'update-needed'
    : states.includes('newer')
      ? 'newer'
      : states.every((state) => state === 'current')
        ? 'current'
        : 'unknown';
  return {
    targetVersion,
    status,
    needsUpdate: status === 'update-needed',
    detail: versionStatusDetail(status, targetVersion, tarae.version, topa.version)
  };
}

function binaryVersionState(version, targetVersion) {
  if (!targetVersion) {
    return 'unknown';
  }
  if (!version) {
    return 'missing';
  }
  const comparison = compareSemver(version, targetVersion);
  if (comparison < 0) {
    return 'update-needed';
  }
  if (comparison > 0) {
    return 'newer';
  }
  return 'current';
}

function versionStatusDetail(status, targetVersion, taraeVersion, topaVersion) {
  const versions = `extension v${targetVersion} · tarae ${taraeVersion ? `v${taraeVersion}` : 'missing'} · topa ${topaVersion ? `v${topaVersion}` : 'missing'}`;
  if (status === 'current') {
    return `${versions} · runtime current`;
  }
  if (status === 'update-needed') {
    return `${versions} · update needed`;
  }
  if (status === 'newer') {
    return `${versions} · local runtime is newer than this extension`;
  }
  return versions;
}

function compareSemver(a, b) {
  const left = semverParts(a);
  const right = semverParts(b);
  for (let index = 0; index < 3; index += 1) {
    if (left[index] !== right[index]) {
      return left[index] - right[index];
    }
  }
  return 0;
}

function semverParts(version) {
  const match = String(version || '').match(/^(\d+)\.(\d+)\.(\d+)/);
  if (!match) {
    return [0, 0, 0];
  }
  return match.slice(1).map((part) => Number(part));
}

function normalizePath(value) {
  return path.resolve(String(value || ''));
}

function shortError(error) {
  const message = error && error.message ? error.message : String(error || '');
  return message.replace(/\s+/g, ' ').trim().slice(0, 300);
}

module.exports = {
  readRuntimeStatus
};
