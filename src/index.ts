#!/usr/bin/env node
import { Command } from 'commander';
import { select } from '@inquirer/prompts';
import chalk from 'chalk';
import { initCommand } from './commands/init.js';

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
  .action(async () => {
    console.log(chalk.dim('  pull not yet implemented'));
  });

program
  .command('push')
  .description('Push local data to cloud database')
  .option('-y, --yes', 'Skip confirmation prompt')
  .action(async () => {
    console.log(chalk.dim('  push not yet implemented'));
  });

program
  .command('preview')
  .description('Preview what would be synced (dry run)')
  .action(async () => {
    console.log(chalk.dim('  preview not yet implemented'));
  });

program
  .command('status')
  .description('Check connections and data summary')
  .action(async () => {
    console.log(chalk.dim('  status not yet implemented'));
  });

program
  .command('settings')
  .description('Configure credentials and sync options')
  .action(async () => {
    console.log(chalk.dim('  settings not yet implemented'));
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
        console.log(chalk.dim('  pull not yet implemented'));
        break;
      case 'push':
        console.log(chalk.dim('  push not yet implemented'));
        break;
      case 'preview':
        console.log(chalk.dim('  preview not yet implemented'));
        break;
      case 'status':
        console.log(chalk.dim('  status not yet implemented'));
        break;
      case 'settings':
        console.log(chalk.dim('  settings not yet implemented'));
        break;
      case 'exit':
        console.log(chalk.dim('\nGoodbye!\n'));
        process.exit(0);
    }
  }
}
