import { useState } from 'react';
import { Box, Text, useApp } from 'ink';
import SelectInput from 'ink-select-input';
import { listProjects, getDefaultProject, setDefaultProject } from '../../core/registry.js';
import type { Screen } from '../types.js';

interface MenuScreenProps {
  navigate: (screen: Screen) => void;
}

type MenuValue = Screen | 'switch' | 'exit';

interface MenuItem {
  label: string;
  value: MenuValue;
}

export function MenuScreen({ navigate }: MenuScreenProps) {
  const { exit } = useApp();
  const [showProjectPicker, setShowProjectPicker] = useState(false);

  const projects = listProjects();
  const defaultProject = getDefaultProject();
  const hasMultipleProjects = projects.length > 1;

  const items: MenuItem[] = [
    { label: 'Init              Set up a new project', value: 'init' },
    { label: 'Pull to Local     Download cloud data', value: 'pull' },
    { label: 'Push to Cloud     Upload local data', value: 'push' },
    { label: 'Preview           Dry run (no changes)', value: 'preview' },
    { label: 'Status            Connections & data summary', value: 'status' },
    { label: 'Settings          Configure credentials', value: 'settings' },
  ];

  if (hasMultipleProjects) {
    items.push({ label: 'Switch Project    Change active project', value: 'switch' });
  }

  items.push({ label: 'Exit              Quit supabase-sync', value: 'exit' });

  const projectItems = projects.map((p) => ({
    label: `${p.name}${defaultProject?.id === p.id ? ' (current)' : ''}`,
    value: p.id,
  }));

  const handleSelect = (item: { label: string; value: MenuValue }) => {
    if (item.value === 'exit') {
      exit();
      return;
    }
    if (item.value === 'switch') {
      setShowProjectPicker(true);
      return;
    }
    navigate(item.value);
  };

  const handleProjectSelect = (item: { label: string; value: string }) => {
    setDefaultProject(item.value);
    setShowProjectPicker(false);
  };

  if (showProjectPicker) {
    return (
      <Box flexDirection="column">
        <Text bold>Switch Project</Text>
        <Text dimColor>Select a project to make active:</Text>
        <Box marginTop={1}>
          <SelectInput items={projectItems} onSelect={handleProjectSelect} />
        </Box>
      </Box>
    );
  }

  return (
    <Box flexDirection="column">
      <Text bold>What would you like to do?</Text>
      <Box marginTop={1}>
        <SelectInput items={items} onSelect={handleSelect} />
      </Box>
    </Box>
  );
}
