#!/usr/bin/env node
import { Command } from 'commander';
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

  // Suppress console output while Ink is active
  const origLog = console.log;
  const origError = console.error;
  const origWarn = console.warn;
  console.log = () => {};
  console.error = () => {};
  console.warn = () => {};

  try {
    const { waitUntilExit } = render(React.createElement(App));
    await waitUntilExit();
  } finally {
    // Restore console and screen
    console.log = origLog;
    console.error = origError;
    console.warn = origWarn;
    process.stdout.write('\x1b[?1049l');
  }
} else {
  program.parse();
}
