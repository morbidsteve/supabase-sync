#!/usr/bin/env node
import { Command } from 'commander';
import { select } from '@inquirer/prompts';
import chalk from 'chalk';
import { initCommand } from './commands/init.js';
import { statusCommand } from './commands/status.js';
import { previewCommand } from './commands/preview.js';
import { pullCommand } from './commands/pull.js';
import { pushCommand } from './commands/push.js';
import { settingsCommand } from './commands/settings.js';
import { listProjects, getDefaultProject } from './core/registry.js';

const program = new Command();

program
  .name('supabase-sync')
  .description('Sync data between Supabase cloud and local Postgres')
  .version('0.1.0')
  .option('-p, --project <id>', 'Project ID to operate on');

program
  .command('init')
  .description('Initialize configuration and register a project')
  .action(async () => {
    await initCommand();
  });

program
  .command('pull')
  .description('Pull cloud data to local database')
  .option('-y, --yes', 'Skip confirmation prompt')
  .action(async (opts) => {
    const projectId = program.opts().project;
    await pullCommand({ yes: opts.yes, projectId });
  });

program
  .command('push')
  .description('Push local data to cloud database')
  .option('-y, --yes', 'Skip confirmation prompt')
  .action(async (opts) => {
    const projectId = program.opts().project;
    await pushCommand({ yes: opts.yes, projectId });
  });

program
  .command('preview')
  .description('Preview what would be synced (dry run)')
  .action(async () => {
    const projectId = program.opts().project;
    await previewCommand({ projectId });
  });

program
  .command('status')
  .description('Check connections and data summary')
  .action(async () => {
    const projectId = program.opts().project;
    await statusCommand({ projectId });
  });

program
  .command('settings')
  .description('Configure credentials and sync options')
  .action(async () => {
    const projectId = program.opts().project;
    await settingsCommand({ projectId });
  });

// If no subcommand given, launch TUI
if (process.argv.length <= 2) {
  const { render } = await import('ink');
  const React = await import('react');
  const { App } = await import('./tui/App.js');
  // Enter alternate screen buffer (like vim/htop)
  process.stdout.write('\x1b[?1049h');
  const { waitUntilExit } = render(React.createElement(App));
  await waitUntilExit();
  // Restore normal screen
  process.stdout.write('\x1b[?1049l');
} else {
  program.parse();
}

async function interactiveMenu() {
  while (true) {
    const projects = listProjects();
    const defaultProject = getDefaultProject();
    const projectLabel = defaultProject ? chalk.dim(` [${defaultProject.name}]`) : '';

    console.log(`\n${chalk.bold.cyan('Supabase Sync')}${projectLabel}`);
    console.log(chalk.dim('─'.repeat(40)));
    console.log('');

    const choices = [
      { name: 'Init              Set up a new project', value: 'init' },
      { name: 'Pull to Local     Download cloud data to local', value: 'pull' },
      { name: 'Push to Cloud     Upload local data to cloud', value: 'push' },
      { name: 'Preview           Dry run (no changes)', value: 'preview' },
      { name: 'Status            Check connections & data summary', value: 'status' },
      { name: 'Settings          Configure credentials', value: 'settings' },
    ];

    if (projects.length > 1) {
      choices.push({ name: 'Switch Project    Change active project', value: 'switch' });
    }

    choices.push({ name: 'Exit', value: 'exit' });

    const action = await select({
      message: 'What would you like to do?',
      choices,
    });

    switch (action) {
      case 'init':
        await initCommand();
        break;
      case 'pull':
        await pullCommand();
        break;
      case 'push':
        await pushCommand();
        break;
      case 'preview':
        await previewCommand();
        break;
      case 'status':
        await statusCommand();
        break;
      case 'settings':
        await settingsCommand();
        break;
      case 'switch': {
        const projectChoices = projects.map(p => ({
          name: `${p.name}${p.id === defaultProject?.id ? ' (current)' : ''}`,
          value: p.id,
        }));
        const selectedId = await select({
          message: 'Switch to which project?',
          choices: projectChoices,
        });
        const { setDefaultProject } = await import('./core/registry.js');
        setDefaultProject(selectedId);
        const selected = projects.find(p => p.id === selectedId);
        console.log(chalk.green(`Switched to ${selected?.name ?? selectedId}`));
        break;
      }
      case 'exit':
        console.log(chalk.dim('\nGoodbye!\n'));
        process.exit(0);
    }
  }
}
