import { Box, useInput } from 'ink';
import { Header } from './Header.js';
import { Footer } from './Footer.js';

interface LayoutProps {
  title: string;
  projectName?: string;
  children: React.ReactNode;
  hints?: { key: string; label: string }[];
  onQuit: () => void;
  onBack: () => void;
  inputActive?: boolean;
}

const DEFAULT_HINTS = [
  { key: 'esc', label: 'Back' },
  { key: 'q', label: 'Quit' },
];

export function Layout({
  title,
  projectName,
  children,
  hints,
  onQuit,
  onBack,
  inputActive = false,
}: LayoutProps) {
  useInput((input, key) => {
    if (inputActive) return;
    if (input === 'q') {
      onQuit();
    }
    if (key.escape) {
      onBack();
    }
  });

  const footerHints = hints ?? DEFAULT_HINTS;

  return (
    <Box flexDirection="column" flexGrow={1}>
      <Header screenTitle={title} projectName={projectName} />
      <Box flexDirection="column" flexGrow={1} paddingX={2}>
        {children}
      </Box>
      <Footer hints={footerHints} />
    </Box>
  );
}
