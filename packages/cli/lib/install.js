import chalk from 'chalk';
import { initAction } from './init.js';
import { linkAction } from './link.js';
import { verifyAction } from './verify.js';
import {
  defaultProjectName,
  mergeGlobalConfig,
  resolveProjectRoot,
} from './config.js';

export async function installAction(options = {}) {
  const projectRoot = resolveProjectRoot(options);
  const agent = options.agent || 'codex';
  const projectName = defaultProjectName(projectRoot);

  console.log(chalk.cyan('=== Tarae Install ===\n'));
  console.log(chalk.gray(`Agent: ${agent}`));
  console.log(chalk.gray(`Project: ${projectName}`));
  console.log(chalk.gray(`Project root: ${projectRoot}\n`));

  await initAction();
  await linkAction(agent, { projectRoot });
  mergeGlobalConfig({
    default_agent: agent,
    project_root: projectRoot,
    project_name: projectName,
  });

  await verifyAction({
    agent,
    projectRoot,
    strict: true,
  });

  console.log(chalk.bold.green('\nTarae install completed.'));
  console.log(chalk.gray('Restart the target AI app if it was already open so it reloads MCP settings.'));
}
