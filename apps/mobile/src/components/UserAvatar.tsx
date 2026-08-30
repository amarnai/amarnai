import { StyleSheet, Text, View } from 'react-native';
import { userInitials } from '@aziru/core';
import { colors, radii, fontWeight } from '@aziru/tokens';

// Circular avatar with the user's initials, mirroring the web sidebar's
// `.sidebar-avatar`. Solid accent fill rather than the web gradient to avoid a
// gradient dependency; the brand color reads the same intent.
export function UserAvatar({
  name,
  email,
  size = 40,
}: {
  name: string | null;
  email: string;
  size?: number;
}) {
  return (
    <View
      style={[
        styles.avatar,
        { width: size, height: size, borderRadius: radii.full },
      ]}
    >
      <Text style={[styles.text, { fontSize: size * 0.36 }]}>
        {userInitials(name, email)}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  avatar: {
    backgroundColor: colors.accent,
    alignItems: 'center',
    justifyContent: 'center',
  },
  text: {
    color: '#ffffff',
    fontWeight: fontWeight.semibold,
  },
});
