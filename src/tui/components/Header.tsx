import { Box, Text } from 'ink';

interface HeaderProps {
  projectName?: string;
  screenTitle: string;
}

const DIVIDER = '\u2500'.repeat(40);

export function Header({ projectName, screenTitle }: HeaderProps) {
  return (
    <Box flexDirection="column" paddingX={1}>
      <Box gap={1}>
        <Text bold color="cyan">supabase-sync</Text>
        {projectName && (
          <>
            <Text dimColor>{'\u00b7'}</Text>
            <Text>{projectName}</Text>
          </>
        )}
        <Text dimColor>{'\u00b7'}</Text>
        <Text>{screenTitle}</Text>
      </Box>
      <Text dimColor>{DIVIDER}</Text>
    </Box>
  );
}
