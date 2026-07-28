import { useEffect, useState } from "react";
import { ext } from "../platform/ext";

/**
 * "unknown" means the browser will not tell us (no `action.getUserSettings`),
 * not that the icon is unpinned. Firefox is the case that matters: it has no
 * such API and pins toolbar buttons on install anyway, so treating unknown as
 * unpinned would show every Firefox user a step they have already completed.
 */
export type PinState = "unknown" | "pinned" | "unpinned";

// Fast enough that checking the step off feels like a reaction to the click,
// slow enough to be free. The call is a synchronous read of local browser
// state, so this is not a network poll.
const POLL_MS = 1000;

/**
 * Watches whether the extension's icon is pinned to the browser toolbar.
 *
 * There is no API to pin an extension programmatically — deliberately, on both
 * browsers — so the best onboarding can do is ask, then notice. Polling is the
 * only option: pinning fires no event, and it happens in browser chrome (the
 * puzzle-piece menu) that never takes focus away from the page, so there is no
 * blur or visibility change to hang the re-check on either.
 *
 * Polling stops for good once pinned: a user does not pin and then unpin mid
 * first-run, and a step that could un-check itself would read as a glitch.
 */
export function usePinnedState(): PinState {
  const [state, setState] = useState<PinState>("unknown");

  useEffect(() => {
    if (typeof ext.action?.getUserSettings !== "function") return;

    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;

    async function check() {
      // Nothing to react to in a background tab, and the answer cannot have
      // changed without the user being here to change it.
      if (!document.hidden) {
        try {
          const { isOnToolbar } = await ext.action.getUserSettings();
          if (cancelled) return;
          setState(isOnToolbar ? "pinned" : "unpinned");
          if (isOnToolbar) return;
        } catch {
          // A browser that exposes the API but rejects the call is one we
          // cannot track. Fall back to the generic tip rather than nag.
          if (!cancelled) setState("unknown");
          return;
        }
      }
      timer = setTimeout(() => void check(), POLL_MS);
    }

    void check();

    return () => {
      cancelled = true;
      if (timer !== undefined) clearTimeout(timer);
    };
  }, []);

  return state;
}
