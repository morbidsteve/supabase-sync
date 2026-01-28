import { Box, Text, useInput } from 'ink';

interface ConfirmPromptProps {
  message: string;
  destructive?: boolean;
  onConfirm: (yes: boolean) => void;
}

export function ConfirmPrompt({ message, destructive = false, onConfirm }: ConfirmPromptProps) {
  useInput((input) => {
    const lower = input.toLowerCase();
    if (lower === 'y') {
      onConfirm(true);
    } else if (lower === 'n') {
      onConfirm(false);
    }
  });

  const hint = destructive ? '[y/N]' : '[Y/n]';

  return (
    <Box gap={1}>
      {destructive ? (
        <Text color="red">{message}</Text>
      ) : (
        <Text>{message}</Text>
      )}
      <Text dimColor>{hint}</Text>
    </Box>
  );
}
