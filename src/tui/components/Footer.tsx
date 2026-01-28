import { Box, Text } from 'ink';

interface FooterHint {
  key: string;
  label: string;
}

interface FooterProps {
  hints: FooterHint[];
}

export function Footer({ hints }: FooterProps) {
  return (
    <Box flexDirection="column" paddingX={1}>
      <Text dimColor>{'\u2500'.repeat(40)}</Text>
      <Box gap={2}>
        {hints.map((hint) => (
          <Box key={hint.key} gap={1}>
            <Text bold>{hint.key}</Text>
            <Text dimColor>{hint.label}</Text>
          </Box>
        ))}
      </Box>
    </Box>
  );
}
