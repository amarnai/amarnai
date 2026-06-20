import { useCallback, useEffect, useId, useRef, type ReactNode } from 'react';
import {
  Animated,
  KeyboardAvoidingView,
  Platform,
  StyleSheet,
  TouchableOpacity,
  useWindowDimensions,
} from 'react-native';
import { usePortal } from '../portal';

interface BottomSheetProps {
  visible: boolean;
  onClose: () => void;
  children: ReactNode;
  keyboardAvoiding?: boolean;
}

const SLIDE_MS = 300;
const FADE_MS = 150;

export function BottomSheet({ visible, onClose, children, keyboardAvoiding }: BottomSheetProps) {
  const id = useId();
  const { register, unregister, invalidate } = usePortal();

  const translateY = useRef(new Animated.Value(0)).current;
  const overlay = useRef(new Animated.Value(0)).current;

  // Refs for values that change independently of the animation/portal lifecycle.
  // Using refs avoids re-running stable effects when these values change.
  const { height } = useWindowDimensions();
  const heightRef = useRef(height);
  heightRef.current = height;
  const isActive = useRef(false);
  const childrenRef = useRef(children);
  childrenRef.current = children;
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  const keyboardAvoidingRef = useRef(keyboardAvoiding);
  keyboardAvoidingRef.current = keyboardAvoiding;

  // handleClose only depends on stable Animated values — no height or onClose
  // in the dep array, so the register effect below never needs to re-run.
  const handleClose = useCallback(() => {
    overlay.stopAnimation();
    Animated.parallel([
      Animated.timing(translateY, {
        toValue: heightRef.current,
        duration: SLIDE_MS,
        useNativeDriver: true,
      }),
      Animated.timing(overlay, { toValue: 0, duration: FADE_MS, useNativeDriver: true }),
    ]).start(() => {
      isActive.current = false;
      onCloseRef.current();
    });
  }, [translateY, overlay]);

  // Register once on mount; clean up on unmount. Stable deps mean this never
  // re-fires mid-session, so the portal entry is never briefly absent.
  useEffect(() => {
    register(id, () => {
      if (!isActive.current) return null;

      const inner = (
        <TouchableOpacity style={styles.fill} activeOpacity={1} onPress={handleClose}>
          <Animated.View style={{ transform: [{ translateY }] }}>
            <TouchableOpacity activeOpacity={1}>{childrenRef.current}</TouchableOpacity>
          </Animated.View>
        </TouchableOpacity>
      );

      return (
        <>
          <Animated.View style={[styles.backdrop, { opacity: overlay }]} pointerEvents="none" />
          {keyboardAvoidingRef.current ? (
            <KeyboardAvoidingView
              style={styles.fill}
              behavior={Platform.OS === 'ios' ? 'padding' : undefined}
            >
              {inner}
            </KeyboardAvoidingView>
          ) : (
            inner
          )}
        </>
      );
    });
    return () => unregister(id);
  }, [id, register, unregister, handleClose, translateY, overlay]);

  // Drive open / close animations.
  useEffect(() => {
    if (visible) {
      isActive.current = true;
      translateY.setValue(heightRef.current);
      overlay.setValue(0);
      invalidate();
      Animated.timing(translateY, {
        toValue: 0,
        duration: SLIDE_MS,
        useNativeDriver: true,
      }).start();
      const t = setTimeout(() => {
        Animated.timing(overlay, { toValue: 1, duration: FADE_MS, useNativeDriver: true }).start();
      }, SLIDE_MS);
      return () => clearTimeout(t);
    } else {
      translateY.stopAnimation();
      overlay.stopAnimation();
      translateY.setValue(heightRef.current);
      overlay.setValue(0);
      isActive.current = false;
      invalidate();
    }
  }, [visible, translateY, overlay, invalidate]);

  // Push updated children to the overlay on every render while visible. Safe
  // because PortalOverlay is isolated — its re-renders don't cascade to the
  // screen that mounts this component.
  useEffect(() => {
    if (visible) invalidate();
  });

  return null;
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
