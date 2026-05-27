import fs from 'fs-extra';
import path from 'path';
import chalk from 'chalk';
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
  console.log(chalk.gray('MCP clients start topa on demand through their MCP configuration.'));
}
