import { StyleSheet, Text, View } from 'react-native';
import { workspaceInitials, workspaceHue } from '@aziru/core';
import { radii, fontWeight } from '@aziru/tokens';

// Colored rounded square with the workspace's initials, mirroring the web
// sidebar's `.ws-mark`. The hue is derived deterministically from the name so a
// workspace always renders the same color. RN supports hsl() color strings.
export function WorkspaceMark({ name, size = 28 }: { name: string; size?: number }) {
  const hue = workspaceHue(name);
  return (
    <View
      style={[
        styles.mark,
        {
          width: size,
          height: size,
          borderRadius: radii.sm,
          backgroundColor: `hsl(${hue}, 50%, 55%)`,
        },
      ]}
    >
      <Text style={[styles.text, { fontSize: size * 0.4 }]}>{workspaceInitials(name)}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  mark: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  text: {
    color: '#ffffff',
    fontWeight: fontWeight.bold,
  },
});
