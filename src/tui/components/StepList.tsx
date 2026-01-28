import { Box, Text } from 'ink';
import Spinner from 'ink-spinner';
import type { TaskStep } from '../types.js';

interface StepListProps {
  steps: TaskStep[];
}

function StepIcon({ status }: { status: TaskStep['status'] }) {
  switch (status) {
    case 'running':
      return <Text color="yellow"><Spinner type="dots" /></Text>;
    case 'success':
      return <Text color="green">{'\u2714'}</Text>;
    case 'error':
      return <Text color="red">{'\u2716'}</Text>;
    case 'warning':
      return <Text color="yellow">{'\u26a0'}</Text>;
    case 'idle':
    default:
      return <Text dimColor>{'\u25cb'}</Text>;
  }
}

function StepLabel({ step }: { step: TaskStep }) {
  switch (step.status) {
    case 'running':
      return <Text color="yellow">{step.label}</Text>;
    case 'error':
      return (
        <Box gap={1}>
          <Text>{step.label}</Text>
          {step.detail && <Text color="red" dimColor>{step.detail}</Text>}
        </Box>
      );
    case 'success':
      return (
        <Box gap={1}>
          <Text>{step.label}</Text>
          {step.detail && <Text dimColor>{step.detail}</Text>}
        </Box>
      );
    default:
      return <Text>{step.label}</Text>;
  }
}

export function StepList({ steps }: StepListProps) {
  return (
    <Box flexDirection="column">
      {steps.map((step, i) => (
        <Box key={i} gap={1}>
          <StepIcon status={step.status} />
          <StepLabel step={step} />
        </Box>
      ))}
    </Box>
  );
}
