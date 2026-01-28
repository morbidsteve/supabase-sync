import { Box, Text } from 'ink';

interface StatusLineProps {
  label: string;
  value: string | number;
  pad?: number;
}

export function StatusLine({ label, value, pad = 20 }: StatusLineProps) {
  return (
    <Box paddingLeft={2}>
      <Text>{label.padEnd(pad)}</Text>
      <Text> {String(value)}</Text>
    </Box>
  );
}
