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

const program = new Command();

program
  .name('supabase-sync')
  .description('Sync data between Supabase cloud and local Postgres')
  .version('0.1.0');

program
  .command('init')
  .description('Initialize configuration in current directory')
  .action(async () => {
    await initCommand();
  });

program
  .command('pull')
  .description('Pull cloud data to local database')
  .option('-y, --yes', 'Skip confirmation prompt')
  .action(async (opts) => {
    await pullCommand({ yes: opts.yes });
  });

program
  .command('push')
  .description('Push local data to cloud database')
  .option('-y, --yes', 'Skip confirmation prompt')
  .action(async (opts) => {
    await pushCommand({ yes: opts.yes });
  });

program
  .command('preview')
  .description('Preview what would be synced (dry run)')
  .action(async () => {
    await previewCommand();
  });

program
  .command('status')
  .description('Check connections and data summary')
  .action(async () => {
    await statusCommand();
  });

program
  .command('settings')
  .description('Configure credentials and sync options')
  .action(async () => {
    await settingsCommand();
  });

// If no subcommand given, show interactive menu
if (process.argv.length <= 2) {
  interactiveMenu().catch((err) => {
    console.error(chalk.red('Fatal error:'), err);
    process.exit(1);
  });
} else {
  program.parse();
}

async function interactiveMenu() {
  while (true) {
    console.log(`\n${chalk.bold.cyan('Supabase Sync')}`);
    console.log(chalk.dim('─'.repeat(40)));
    console.log('');

    const action = await select({
      message: 'What would you like to do?',
      choices: [
        { name: 'Init              Set up configuration', value: 'init' },
        { name: 'Pull to Local     Download cloud data to local', value: 'pull' },
        { name: 'Push to Cloud     Upload local data to cloud', value: 'push' },
        { name: 'Preview           Dry run (no changes)', value: 'preview' },
        { name: 'Status            Check connections & data summary', value: 'status' },
        { name: 'Settings          Configure credentials', value: 'settings' },
        { name: 'Exit', value: 'exit' },
      ],
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
      case 'exit':
        console.log(chalk.dim('\nGoodbye!\n'));
        process.exit(0);
    }
  }
}
