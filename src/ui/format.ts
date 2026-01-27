import chalk from 'chalk';

export const DIVIDER = '─'.repeat(40);

export function header(title: string): string {
  return `\n${chalk.bold.cyan(title)}\n${chalk.dim(DIVIDER)}`;
}

export function success(msg: string): string {
  return chalk.green(`✓ ${msg}`);
}

export function warn(msg: string): string {
  return chalk.yellow(`⚠ ${msg}`);
}

export function error(msg: string): string {
  return chalk.red(`✗ ${msg}`);
}

export function info(msg: string): string {
  return chalk.dim(`  ${msg}`);
}

export function tableRow(label: string, value: string | number, pad = 20): string {
  return `  ${label.padEnd(pad)} ${value}`;
}

export function sectionTitle(title: string): string {
  return chalk.bold(`\n${title}`);
}
