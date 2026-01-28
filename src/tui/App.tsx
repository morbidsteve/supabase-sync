import { Box, Text, useApp } from 'ink';
import { useNavigation } from './hooks/useNavigation.js';
import { Layout } from './components/Layout.js';
import { MenuScreen } from './screens/MenuScreen.js';
import { StatusScreen } from './screens/StatusScreen.js';
import { PullScreen } from './screens/PullScreen.js';
import { PushScreen } from './screens/PushScreen.js';
import { PreviewScreen } from './screens/PreviewScreen.js';
import { getDefaultProject } from '../core/registry.js';
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
  const defaultProject = getDefaultProject();

  const renderScreen = () => {
    switch (nav.current) {
      case 'menu':
        return <MenuScreen navigate={nav.navigate} />;
      case 'status':
        return <StatusScreen onBack={nav.goBack} />;
      case 'pull':
        return <PullScreen onBack={nav.goBack} />;
      case 'push':
        return <PushScreen onBack={nav.goBack} />;
      case 'preview':
        return <PreviewScreen onBack={nav.goBack} />;
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
      projectName={defaultProject?.name}
      onQuit={() => exit()}
      onBack={nav.goBack}
    >
      {renderScreen()}
    </Layout>
  );
}
