#!/usr/bin/env node

import { Command } from 'commander';
import fs from 'fs';
import chalk from 'chalk';
import { initAction } from '../lib/init.js';
import { installAction } from '../lib/install.js';
import { linkAction } from '../lib/link.js';
import { statusAction } from '../lib/status.js';
import { doctorAction } from '../lib/doctor.js';
import { unlinkAction } from '../lib/unlink.js';
import { uninstallAction } from '../lib/uninstall.js';
import { verifyAction } from '../lib/verify.js';
import { upgradeAction } from '../lib/upgrade.js';

const packageJson = JSON.parse(fs.readFileSync(new URL('../package.json', import.meta.url), 'utf8'));

const program = new Command();

program
  .name('tarae')
  .description('Tarae CLI - local AI Agent MCP history')
  .version(packageJson.version);

program
  .command('init')
  .description('Initialize Tarae workspace and copy/link topa binary')
  .action(async () => {
    try {
      await initAction();
    } catch (err) {
      console.error(chalk.red(`Error: ${err.message}`));
      process.exit(1);
    }
  });

program
  .command('install')
  .description('Install Tarae for a project: init, link MCP, and verify')
  .option('--agent <agent>', 'AI agent to link (cursor, claude, gemini, codex, or a custom agent name)', 'codex')
  .option('--config-path <path>', 'MCP config file path for custom or overridden agent config')
  .option('--config-format <format>', 'MCP config format for --config-path (json or toml)')
  .option('--link-id <id>', 'Stable Tarae MCP link id for multi-agent attribution')
  .option('--fixed-project-root', 'Write --project-root into MCP config instead of resolving it at call time')
  .option('--project-root <path>', 'Project root directory that topa is allowed to watch')
  .action(async (options, cmd) => {
    try {
      await installAction(cmd.opts());
    } catch (err) {
      console.error(chalk.red(`Error: ${err.message}`));
      process.exit(1);
    }
  });

program
  .command('link [agent]')
  .description('Link Tarae MCP server to an AI agent config')
  .option('--config-path <path>', 'MCP config file path for custom or overridden agent config')
  .option('--config-format <format>', 'MCP config format for --config-path (json or toml)')
  .option('--link-id <id>', 'Stable Tarae MCP link id for multi-agent attribution')
  .option('--fixed-project-root', 'Write --project-root into MCP config instead of resolving it at call time')
  .option('--project-root <path>', 'Project root directory that topa is allowed to watch')
  .action(async (agent, options, cmd) => {
    try {
      await linkAction(agent, cmd.opts());
    } catch (err) {
      console.error(chalk.red(`Error: ${err.message}`));
      process.exit(1);
    }
  });

program
  .command('verify')
  .description('Verify topa installation, local history, and MCP agent config')
  .option('--agent <agent>', 'Only verify one AI agent config')
  .option('--config-path <path>', 'MCP config file path for custom or overridden agent config')
  .option('--config-format <format>', 'MCP config format for --config-path (json or toml)')
  .option('--project-root <path>', 'Project root directory that topa is allowed to watch')
  .option('--strict', 'Exit with an error if any verification check fails')
  .option('--no-mcp-smoke', 'Skip spawning topa for MCP lifecycle tool-list smoke test')
  .action(async (options, cmd) => {
    try {
      await verifyAction(cmd.opts());
    } catch (err) {
      console.error(chalk.red(`Error: ${err.message}`));
      process.exit(1);
    }
  });

program
  .command('upgrade')
  .description('Upgrade the local Tarae CLI shim and topa binary')
  .option('--ref <ref>', 'Git branch or tag to install, for example main or v0.1.9')
  .option('--repo-url <url>', 'Tarae git repository URL')
  .option('--install-dir <path>', 'Tarae source install directory')
  .option('--bin-dir <path>', 'Directory for tarae/topa shims and binaries')
  .option('--build-from-source', 'Build topa from the selected source ref instead of downloading a release asset')
  .option('--project-root <path>', 'Project root whose daemon should be stopped and verified')
  .option('--agent <agent>', 'Agent config to verify after upgrade')
  .option('--config-path <path>', 'MCP config file path for custom or overridden agent config')
  .option('--config-format <format>', 'MCP config format for --config-path (json or toml)')
  .option('--skip-verify', 'Skip verification after upgrade')
  .option('--no-mcp-smoke', 'Skip spawning topa during post-upgrade verification')
  .action(async (options, cmd) => {
    try {
      await upgradeAction(cmd.opts());
    } catch (err) {
      console.error(chalk.red(`Error: ${err.message}`));
      process.exit(1);
    }
  });

program
  .command('status')
  .description('Check the status of topa local history and background process')
  .option('--project-root <path>', 'Project root directory')
  .action(async (options, cmd) => {
    try {
      await statusAction(cmd.opts());
    } catch (err) {
      console.error(chalk.red(`Error: ${err.message}`));
      process.exit(1);
    }
  });

program
  .command('doctor')
  .description('Diagnose Tarae local setup and history directory')
  .option('--project-root <path>', 'Project root directory')
  .action(async (options, cmd) => {
    try {
      await doctorAction(cmd.opts());
    } catch (err) {
      console.error(chalk.red(`Error: ${err.message}`));
      process.exit(1);
    }
  });

program
  .command('uninstall')
  .description('Stop Tarae, unlink MCP configs, and optionally remove local Tarae state')
  .option('--agent <agent>', 'Only unlink one AI agent config')
  .option('--all', 'Unlink Tarae from every supported agent config')
  .option('--keep-config', 'Keep ~/.tarae/config.json')
  .option('--purge', 'Move ~/.tarae local binary/log/config state aside after unlinking')
  .action(async (options, cmd) => {
    try {
      await uninstallAction(cmd.opts());
    } catch (err) {
      console.error(chalk.red(`Error: ${err.message}`));
      process.exit(1);
    }
  });

program
  .command('unlink [agent]')
  .description('Remove Tarae MCP server from AI agent configs (cursor, claude, gemini, codex)')
  .option('--all', 'Unlink Tarae from every supported agent config')
  .option('--config-path <path>', 'MCP config file path for custom or overridden agent config')
  .option('--config-format <format>', 'MCP config format for --config-path (json or toml)')
  .action(async (agent, options, cmd) => {
    try {
      await unlinkAction(agent, cmd.opts());
    } catch (err) {
      console.error(chalk.red(`Error: ${err.message}`));
      process.exit(1);
    }
  });

program.parse(process.argv);
