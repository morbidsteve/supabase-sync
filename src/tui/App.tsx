import { Box, Text, useApp } from 'ink';
import { useNavigation } from './hooks/useNavigation.js';
import { Layout } from './components/Layout.js';
import type { Screen } from './types.js';

const screenTitles: Record<Screen, string> = {
  menu: 'Menu',
  status: 'Status',
  pull: 'Pull',
  push: 'Push',
  preview: 'Preview',
  init: 'Init',
  settings: 'Settings',
};

export function App() {
  const nav = useNavigation();
  const { exit } = useApp();

  const renderScreen = () => {
    switch (nav.current) {
      case 'menu':
        return <Text>Menu screen placeholder - press q to quit</Text>;
      case 'status':
        return <Text>Status screen - press Escape to go back</Text>;
      case 'pull':
        return <Text>Pull screen - press Escape to go back</Text>;
      case 'push':
        return <Text>Push screen - press Escape to go back</Text>;
      case 'preview':
        return <Text>Preview screen - press Escape to go back</Text>;
      case 'init':
        return <Text>Init screen - press Escape to go back</Text>;
      case 'settings':
        return <Text>Settings screen - press Escape to go back</Text>;
      default:
        return <Text>{nav.current} screen - press Escape to go back</Text>;
    }
  };

  return (
    <Layout
      title={screenTitles[nav.current]}
      onQuit={() => exit()}
      onBack={nav.goBack}
    >
      {renderScreen()}
    </Layout>
  );
}
