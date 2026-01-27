import { confirm as inquirerConfirm } from '@inquirer/prompts';

export async function confirmAction(message: string, defaultValue = true): Promise<boolean> {
  return inquirerConfirm({ message, default: defaultValue });
}

export async function confirmDestructive(message: string): Promise<boolean> {
  return inquirerConfirm({ message, default: false });
}
