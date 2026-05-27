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
  const linkResult = await linkAction(agent, {
    projectRoot,
    configPath: options.configPath,
    configFormat: options.configFormat,
    fixedProjectRoot: options.fixedProjectRoot,
  });
  mergeGlobalConfig({
    default_agent: linkResult?.agent || agent,
    project_root: projectRoot,
    project_name: projectName,
    ...(linkResult?.configPath ? { agent_config_path: linkResult.configPath } : {}),
    ...(linkResult?.configFormat ? { agent_config_format: linkResult.configFormat } : {}),
  });

  await verifyAction({
    agent,
    projectRoot,
    configPath: linkResult?.configPath,
    configFormat: linkResult?.configFormat,
    strict: true,
  });

  console.log(chalk.bold.green('\nTarae install completed.'));
  console.log(chalk.gray('Restart the target AI app if it was already open so it reloads MCP settings.'));
}
