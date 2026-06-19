import { useCallback, useEffect, useRef, type ReactNode } from 'react';
import {
  Animated,
  KeyboardAvoidingView,
  Modal,
  Platform,
  StyleSheet,
  TouchableOpacity,
} from 'react-native';

interface BottomSheetProps {
  visible: boolean;
  onClose: () => void;
  children: ReactNode;
  keyboardAvoiding?: boolean;
}

// Duration of the native slide animation in ms. The overlay starts invisible so
// the dark backdrop doesn't appear to "slide up" with the sheet. It fades in
// after this delay and fades out before the sheet slides back down.
const SLIDE_MS = 300;
const FADE_MS = 150;

export function BottomSheet({ visible, onClose, children, keyboardAvoiding }: BottomSheetProps) {
  const overlay = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (visible) {
      overlay.setValue(0);
      const t = setTimeout(() => {
        Animated.timing(overlay, { toValue: 1, duration: FADE_MS, useNativeDriver: true }).start();
      }, SLIDE_MS);
      return () => clearTimeout(t);
    } else {
      // Reset immediately so the backdrop is gone when the sheet slides down.
      overlay.stopAnimation();
      overlay.setValue(0);
    }
  }, [visible, overlay]);

  const handleClose = useCallback(() => {
    overlay.stopAnimation();
    Animated.timing(overlay, { toValue: 0, duration: FADE_MS, useNativeDriver: true }).start(
      () => onClose(),
    );
  }, [overlay, onClose]);

  const inner = (
    <TouchableOpacity style={styles.fill} activeOpacity={1} onPress={handleClose}>
      <TouchableOpacity activeOpacity={1}>{children}</TouchableOpacity>
    </TouchableOpacity>
  );

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={handleClose}>
      <Animated.View style={[styles.backdrop, { opacity: overlay }]} pointerEvents="none" />
      {keyboardAvoiding ? (
        <KeyboardAvoidingView
          style={styles.fill}
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        >
          {inner}
        </KeyboardAvoidingView>
      ) : (
        inner
      )}
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.4)',
  },
  fill: {
    flex: 1,
    justifyContent: 'flex-end',
  },
});
