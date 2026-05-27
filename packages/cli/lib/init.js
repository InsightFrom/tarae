import fs from 'fs-extra';
import path from 'path';
import os from 'os';
import chalk from 'chalk';
import dotenv from 'dotenv';
import { execFileSync } from 'child_process';
import { fileURLToPath } from 'url';
import zlib from 'zlib';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function topaAssetName() {
  const platform = process.platform;
  const arch = process.arch;

  if (platform === 'darwin' && arch === 'arm64') {
    return 'topa-darwin-arm64.tar.gz';
  }
  if (platform === 'darwin' && arch === 'x64') {
    return 'topa-darwin-x64.tar.gz';
  }
  if (platform === 'linux' && arch === 'x64') {
    return 'topa-linux-x64.tar.gz';
  }
  if (platform === 'linux' && arch === 'arm64') {
    return 'topa-linux-arm64.tar.gz';
  }
  if (platform === 'win32' && arch === 'x64') {
    return 'topa-windows-x64.tar.gz';
  }

  throw new Error(`Unsupported platform for topa binary: ${platform}/${arch}`);
}

function topaBinaryName() {
  return process.platform === 'win32' ? 'topa.exe' : 'topa';
}

async function downloadTopaBinary(destinationPath) {
  const assetName = topaAssetName();
  const downloadUrl = process.env.TARAE_TOPA_DOWNLOAD_URL
    || `${process.env.TARAE_TOPA_DOWNLOAD_BASE_URL || 'https://github.com/InsightFrom/tarae/releases/latest/download'}/${assetName}`;

  console.log(chalk.blue(`Downloading topa release archive from: ${downloadUrl}`));
  const res = await fetch(downloadUrl);
  if (!res.ok) {
    throw new Error(`Failed to download topa release archive (${res.status}). URL: ${downloadUrl}`);
  }

  const bytes = Buffer.from(await res.arrayBuffer());
  const binary = assetName.endsWith('.tar.gz') || downloadUrl.endsWith('.tar.gz')
    ? extractBinaryFromTarGz(bytes, topaBinaryName())
    : bytes;
  fs.writeFileSync(destinationPath, binary);
  fs.chmodSync(destinationPath, 0o755);
  clearMacQuarantine(destinationPath);
  console.log(chalk.green(`topa binary downloaded to: ${destinationPath}`));
}

function extractBinaryFromTarGz(bytes, binaryName) {
  const tar = zlib.gunzipSync(bytes);
  let offset = 0;

  while (offset + 512 <= tar.length) {
    const header = tar.subarray(offset, offset + 512);
    if (isEmptyTarBlock(header)) {
      break;
    }

    const name = readTarString(header, 0, 100);
    const prefix = readTarString(header, 345, 155);
    const entryPath = prefix ? `${prefix}/${name}` : name;
    const size = readTarSize(header);
    const typeflag = header[156];
    const contentStart = offset + 512;
    const contentEnd = contentStart + size;

    if ((typeflag === 0 || typeflag === 48) && path.basename(entryPath) === binaryName) {
      return tar.subarray(contentStart, contentEnd);
    }

    offset = contentStart + Math.ceil(size / 512) * 512;
  }

  throw new Error(`topa binary not found in release archive. Expected: ${binaryName}`);
}

function isEmptyTarBlock(block) {
  for (const byte of block) {
    if (byte !== 0) {
      return false;
    }
  }
  return true;
}

function readTarString(header, start, length) {
  return header
    .subarray(start, start + length)
    .toString('utf8')
    .replace(/\0.*$/, '');
}

function readTarSize(header) {
  const rawSize = readTarString(header, 124, 12).trim();
  return rawSize ? Number.parseInt(rawSize, 8) : 0;
}

function clearMacQuarantine(filePath) {
  if (process.platform !== 'darwin') {
    return;
  }

  try {
    execFileSync('xattr', ['-d', 'com.apple.quarantine', filePath], { stdio: 'ignore' });
    console.log(chalk.green(`macOS quarantine attribute cleared: ${filePath}`));
  } catch {
    // Most curl/node downloads do not have a quarantine attribute.
  }
}

export async function initAction() {
  const homeDir = os.homedir();
  const taraeDir = path.join(homeDir, '.tarae');
  const taraeBinDir = process.env.TARAE_BIN_DIR || path.join(taraeDir, 'bin');
  const taraeBinPath = path.join(taraeBinDir, topaBinaryName());

  console.log(chalk.cyan('Initializing Tarae environment...'));

  // 1. Create directories
  fs.ensureDirSync(taraeDir);
  fs.ensureDirSync(taraeBinDir);
  console.log(chalk.green(`Workspace directories guaranteed: ${taraeDir}`));

  // 2. Detect TARAE_DEV mode from .env.local or process.env
  let devMode = false;
  const envPaths = [
    path.join(process.cwd(), '.env.local'),
    path.join(process.cwd(), 'packages', 'cli', '.env.local'),
    path.join(path.resolve(__dirname, '../../..'), '.env.local'),
  ];

  for (const envPath of envPaths) {
    if (fs.existsSync(envPath)) {
      const envConfig = dotenv.parse(fs.readFileSync(envPath));
      if (envConfig.TARAE_DEV === 'true') {
        devMode = true;
        break;
      }
    }
  }

  if (process.env.TARAE_DEV !== undefined) {
    devMode = process.env.TARAE_DEV === 'true';
  }

  const repoRoot = path.resolve(__dirname, '../../..');
  const topaSourceDev = path.join(repoRoot, 'packages/watcher/target/release', topaBinaryName());
  const forceDownload = process.env.TARAE_FORCE_TOPA_DOWNLOAD === 'true';

  // 3. Process topa binary
  if (devMode) {
    console.log(chalk.yellow('TARAE_DEV=true detected. Setting up symlink to local topa release build...'));

    if (!fs.existsSync(topaSourceDev)) {
      throw new Error(`topa release binary not found at ${topaSourceDev}.\nPlease run "cargo build --release" in packages/watcher first!`);
    }

    if (fs.existsSync(taraeBinPath)) {
      // Remove whatever is there (symlink, file, directory)
      fs.removeSync(taraeBinPath);
    }

    // Create symlink
    fs.symlinkSync(topaSourceDev, taraeBinPath);
    console.log(chalk.green(`Symlink created successfully: ${taraeBinPath} -> ${topaSourceDev}`));
  } else {
    console.log(chalk.blue('Production mode detected. Preparing pre-built topa binary...'));

    if (!forceDownload && fs.existsSync(topaSourceDev)) {
      if (fs.existsSync(taraeBinPath)) {
        fs.removeSync(taraeBinPath);
      }
      fs.copySync(topaSourceDev, taraeBinPath);
      fs.chmodSync(taraeBinPath, 0o755);
      clearMacQuarantine(taraeBinPath);
      console.log(chalk.green(`Pre-built topa binary placed at: ${taraeBinPath}`));
    } else {
      await downloadTopaBinary(taraeBinPath);
    }
  }

  console.log(chalk.bold.green('\n🎉 Tarae init completed successfully!'));
}
