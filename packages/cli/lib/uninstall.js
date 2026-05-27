import fs from 'fs-extra';
import chalk from 'chalk';
import { unlinkAction } from './unlink.js';
import { globalConfigPath, taraeHomeDir } from './config.js';

function backupIfExists(filePath) {
  if (!fs.existsSync(filePath)) {
    return null;
  }

  const backupPath = `${filePath}.bak`;
  fs.copySync(filePath, backupPath);
  return backupPath;
}

export async function uninstallAction(options = {}) {
  console.log(chalk.cyan('=== Tarae Uninstall ===\n'));

  if (options.all || !options.agent) {
    await unlinkAction(null, { all: true });
  } else {
    await unlinkAction(options.agent, {});
  }

  const configPath = globalConfigPath();
  if (!options.keepConfig && fs.existsSync(configPath)) {
    const backupPath = backupIfExists(configPath);
    fs.removeSync(configPath);
    console.log(chalk.green(`Removed Tarae CLI config: ${configPath}`));
    if (backupPath) {
      console.log(chalk.gray(`Backup: ${backupPath}`));
    }
  }

  if (options.purge) {
    const homeDir = taraeHomeDir();
    const backupDir = `${homeDir}.backup-${Date.now()}`;
    if (fs.existsSync(homeDir)) {
      fs.moveSync(homeDir, backupDir, { overwrite: true });
      console.log(chalk.yellow(`Moved Tarae local state to backup: ${backupDir}`));
    }
  } else {
    console.log(chalk.gray(`Local binary/log state is preserved under ${taraeHomeDir()}. Pass --purge to move it aside.`));
  }

  console.log(chalk.bold.green('\nTarae uninstall completed.'));
}
