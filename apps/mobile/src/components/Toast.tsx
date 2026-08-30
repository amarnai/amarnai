import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { colors, radii, space, fontSize, fontWeight, shadows } from '@aziru/tokens';
import type { Toast as ToastModel } from '@aziru/core';

interface ToastProps {
  toast: ToastModel | null;
  onUndo: () => void;
  onDismiss: () => void;
}

// Floating toast that renders the shared view-model's toast, including the
// re-route Undo action. The hook auto-dismisses after a timeout; tapping Undo
// runs the rollback and clears it.
export function Toast({ toast, onUndo, onDismiss }: ToastProps) {
  if (!toast) return null;

  return (
    <View style={styles.wrap} pointerEvents="box-none">
      <View style={styles.toast}>
        <Text style={styles.message} numberOfLines={2}>
          {toast.message}
        </Text>
        {toast.onUndo ? (
          <TouchableOpacity onPress={onUndo} hitSlop={8}>
            <Text style={styles.undo}>Undo</Text>
          </TouchableOpacity>
        ) : (
          <TouchableOpacity onPress={onDismiss} hitSlop={8}>
            <Text style={styles.dismiss}>Dismiss</Text>
          </TouchableOpacity>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: space.xxl,
    alignItems: 'center',
    paddingHorizontal: space.xl,
  },
  toast: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: space.lg,
    backgroundColor: colors.ink,
    borderRadius: radii.lg,
    paddingHorizontal: space.lg,
    paddingVertical: space.md,
    maxWidth: 420,
    width: '100%',
    ...shadows.rn.shadow2,
  },
  message: {
    flex: 1,
    fontSize: fontSize.md,
    color: colors.bg,
  },
  undo: {
    fontSize: fontSize.md,
    fontWeight: fontWeight.semibold,
    color: colors.accent,
  },
  dismiss: {
    fontSize: fontSize.md,
    fontWeight: fontWeight.medium,
    color: colors.ink4,
  },
});
