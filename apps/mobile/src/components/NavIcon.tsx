import type { ComponentProps } from 'react';
import { Ionicons } from '@expo/vector-icons';
import type { NavIconName } from '@aziru/tokens';

type IoniconsName = ComponentProps<typeof Ionicons>['name'];

const IONICON_MAP: Record<NavIconName, { default: IoniconsName; focused: IoniconsName }> = {
  emails:   { default: 'mail-outline',       focused: 'mail' },
  taxonomy: { default: 'git-branch-outline', focused: 'git-branch' },
  settings: { default: 'settings-outline',   focused: 'settings' },
};

export function NavIcon({
  name,
  color,
  size = 24,
  focused = false,
}: {
  name: NavIconName;
  color: string;
  size?: number;
  focused?: boolean;
}) {
  const iconName = focused ? IONICON_MAP[name].focused : IONICON_MAP[name].default;
  return <Ionicons name={iconName} size={size} color={color} />;
}
