import {
  createContext,
  forwardRef,
  useCallback,
  useContext,
  useImperativeHandle,
  useReducer,
  useRef,
  type MutableRefObject,
  type ReactNode,
} from 'react';
import { StyleSheet, View, useWindowDimensions } from 'react-native';

type RenderFn = () => ReactNode;

interface PortalContextValue {
  register: (id: string, fn: RenderFn) => void;
  unregister: (id: string) => void;
  invalidate: () => void;
}

const PortalContext = createContext<PortalContextValue>({
  register: () => {},
  unregister: () => {},
  invalidate: () => {},
});

interface OverlayHandle {
  bump: () => void;
}

// Isolated component so its re-renders never cascade to the main content tree.
// Uses explicit window dimensions so it's anchored to the true screen size,
// not the layout bounds of any ancestor View.
const PortalOverlay = forwardRef<OverlayHandle, { fns: MutableRefObject<Map<string, RenderFn>> }>(
  ({ fns }, ref) => {
    const [, bump] = useReducer((n: number) => n + 1, 0);
    const { width, height } = useWindowDimensions();
    useImperativeHandle(ref, () => ({ bump }), []);

    return (
      <View
        style={{ position: 'absolute', top: 0, left: 0, width, height, zIndex: 9999, elevation: 9999 }}
        pointerEvents="box-none"
      >
        {Array.from(fns.current.entries()).map(([id, fn]) => (
          <View key={id} style={StyleSheet.absoluteFill} pointerEvents="box-none">
            {fn()}
          </View>
        ))}
      </View>
    );
  },
);

// No wrapper View — PortalOverlay is positioned relative to the root window,
// not to a flex container that might be bounded by the tab bar.
export function PortalProvider({ children }: { children: ReactNode }) {
  const fns = useRef<Map<string, RenderFn>>(new Map());
  const overlayRef = useRef<OverlayHandle>(null);

  const register = useCallback((id: string, fn: RenderFn) => {
    fns.current.set(id, fn);
    overlayRef.current?.bump();
  }, []);

  const unregister = useCallback((id: string) => {
    fns.current.delete(id);
    overlayRef.current?.bump();
  }, []);

  const invalidate = useCallback(() => {
    overlayRef.current?.bump();
  }, []);

  return (
    <PortalContext.Provider value={{ register, unregister, invalidate }}>
      {children}
      <PortalOverlay ref={overlayRef} fns={fns} />
    </PortalContext.Provider>
  );
}

export function usePortal() {
  return useContext(PortalContext);
}
