import fs from 'fs-extra';
import path from 'path';
import os from 'os';
import chalk from 'chalk';
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function topaAssetName() {
  const platform = process.platform;
  const arch = process.arch;

  if (platform === 'darwin' && arch === 'arm64') {
    return 'topa-darwin-arm64';
  }
  if (platform === 'darwin' && arch === 'x64') {
    return 'topa-darwin-x64';
  }
  if (platform === 'linux' && arch === 'x64') {
    return 'topa-linux-x64';
  }
  if (platform === 'linux' && arch === 'arm64') {
    return 'topa-linux-arm64';
  }
  if (platform === 'win32' && arch === 'x64') {
    return 'topa-windows-x64.exe';
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

  console.log(chalk.blue(`Downloading topa binary from: ${downloadUrl}`));
  const res = await fetch(downloadUrl);
  if (!res.ok) {
    throw new Error(`Failed to download topa binary (${res.status}). URL: ${downloadUrl}`);
  }

  const bytes = Buffer.from(await res.arrayBuffer());
  fs.writeFileSync(destinationPath, bytes);
  fs.chmodSync(destinationPath, 0o755);
  console.log(chalk.green(`topa binary downloaded to: ${destinationPath}`));
}

export async function initAction() {
  const homeDir = os.homedir();
  const taraeDir = path.join(homeDir, '.tarae');
  const taraeBinDir = path.join(taraeDir, 'bin');
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

  if (process.env.TARAE_DEV === 'true') {
    devMode = true;
  }

  const repoRoot = path.resolve(__dirname, '../../..');
  const topaSourceDev = path.join(repoRoot, 'packages/watcher/target/release', topaBinaryName());

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

    if (fs.existsSync(topaSourceDev)) {
      if (fs.existsSync(taraeBinPath)) {
        fs.removeSync(taraeBinPath);
      }
      fs.copySync(topaSourceDev, taraeBinPath);
      fs.chmodSync(taraeBinPath, 0o755);
      console.log(chalk.green(`Pre-built topa binary placed at: ${taraeBinPath}`));
    } else {
      await downloadTopaBinary(taraeBinPath);
    }
  }

  console.log(chalk.bold.green('\n🎉 Tarae init completed successfully!'));
}
