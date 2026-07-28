import { useEffect, useRef, useState } from "react";
import { Trans } from "@lingui/react/macro";
import { GoogleGIcon, OutlookIcon, ShieldCheckIcon } from "@amarnai/ui";
import { ext } from "../platform/ext";
import { usePinnedState } from "./usePinnedState";
import { WelcomeCarousel } from "./WelcomeCarousel";

/**
 * First-run tab, opened by the background script on install.
 *
 * The left half previews the product with the same three demos the landing
 * page runs; the right half answers the three things a user who arrived
 * straight from the store does not know yet: what Amarnai does, where it
 * lives, and how to start. The only action is opening the panel, where sign-in
 * and everything after it happens.
 */
export function WelcomeApp() {
  // Chrome requires sidePanel.open() to run inside a user gesture, and any
  // await before the call loses it. Resolve the window id up front so the click
  // handler can call straight through.
  const windowIdRef = useRef<number | undefined>(undefined);
  const [fallback, setFallback] = useState(false);
  const pinned = usePinnedState();

  useEffect(() => {
    ext.windows
      ?.getCurrent()
      .then((w) => {
        windowIdRef.current = w.id;
      })
      .catch(() => {});
  }, []);

  function openPanel() {
    // Failure is expected rather than exceptional here (the gesture may not
    // survive, and Firefox's sidebarAction.open() is rejected on some
    // versions), so every path ends in the toolbar-icon hint.
    try {
      const opened =
        ext.sidePanel && windowIdRef.current !== undefined
          ? ext.sidePanel.open({ windowId: windowIdRef.current })
          : ext.sidebarAction?.open();
      if (!opened) {
        setFallback(true);
        return;
      }
      opened.catch(() => setFallback(true));
    } catch {
      setFallback(true);
    }
  }

  return (
    <main className="wc-page">
      {/* Points at the puzzle-piece menu, which sits at the top right of the
          browser chrome directly above this tab. Decorative: the callout below
          carries the same instruction in words. */}
      {pinned === "unpinned" ? (
        <span className="wc-pin-pointer" aria-hidden>
          <svg viewBox="0 0 24 40" width="24" height="40" fill="none">
            <path
              d="M12 39V6"
              stroke="currentColor"
              strokeWidth="2.5"
              strokeLinecap="round"
            />
            <path
              d="M4 13L12 4l8 9"
              stroke="currentColor"
              strokeWidth="2.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </span>
      ) : null}

      <div className="wc-grid">
        <WelcomeCarousel />

        <div className="wc-intro">
          <div className="wc-brand">
            <img src="/icons/icon48.png" width={40} height={40} alt="" />
            <span className="wc-brand-name">Amarnai</span>
          </div>

          <div className="wc-headline">
            <h1 className="wc-title">
              <Trans>Your inbox, sorted your way</Trans>
            </h1>
            <p className="wc-lede">
              <Trans>
                Amarnai files every Gmail and Outlook thread into folders you design,
                from the side panel next to the mail you are already reading.
              </Trans>
            </p>
          </div>

          <ol className="wc-steps">
            <li className="wc-step">
              <span className="wc-step-num" aria-hidden>
                1
              </span>
              <div>
                <h2 className="wc-step-title">
                  <Trans>Design your folders</Trans>
                </h2>
                <p className="wc-step-text">
                  <Trans>
                    Amarnai files every thread into folders you choose. Generate a set from
                    your own inbox, or start from a template.
                  </Trans>
                </p>
              </div>
            </li>
            <li className="wc-step">
              <span className="wc-step-num" aria-hidden>
                2
              </span>
              <div>
                <h2 className="wc-step-title">
                  <Trans>Work next to your email</Trans>
                </h2>
                <p className="wc-step-text">
                  <Trans>
                    Amarnai lives in a side panel beside Gmail and Outlook, so you never
                    have to leave the thread you are reading.
                  </Trans>
                </p>
              </div>
            </li>
            <li className="wc-step">
              <span className="wc-step-num" aria-hidden>
                3
              </span>
              <div>
                <h2 className="wc-step-title">
                  <Trans>Sign in with Google or Microsoft</Trans>
                </h2>
                <p className="wc-step-text">
                  <Trans>
                    One sign-in creates your account, connects your Gmail or Outlook
                    inbox, and lets you build your sorting plan. Amarnai never sends or
                    deletes mail.
                  </Trans>
                </p>
              </div>
            </li>
          </ol>

          <div className="wc-cta-block">
            <button type="button" className="wc-cta" onClick={openPanel}>
              <Trans>Open Amarnai</Trans>
            </button>

            {/* Both mail providers reviewed Amarnai before it could ask for a
                mailbox; saying so under the button is the last thing a
                first-run user wants to know before signing in. */}
            <ul className="wc-assurances">
              <li className="wc-assurance">
                <GoogleGIcon size={14} />
                <Trans>Verified by Google</Trans>
              </li>
              <li className="wc-assurance">
                <OutlookIcon size={14} />
                <Trans>Verified by Microsoft</Trans>
              </li>
              <li className="wc-assurance">
                <ShieldCheckIcon size={14} />
                <Trans>CASA Tier 2 certified</Trans>
              </li>
            </ul>
          </div>

          {fallback ? (
            <p className="wc-hint" role="status">
              <Trans>Click the Amarnai icon in your toolbar to open the panel.</Trans>
            </p>
          ) : null}

          {/* Browsers give extensions no way to pin themselves, so this asks, then
              watches. "unknown" is a browser that will not say (Firefox pins on
              install), which gets the plain tip instead of a step it cannot pass. */}
          {pinned === "unpinned" ? (
            <div className="wc-pin" role="status">
              <h2 className="wc-pin-title">
                <Trans>Pin Amarnai to your toolbar</Trans>
              </h2>
              <p className="wc-pin-text">
                <Trans>
                  Click the puzzle-piece icon at the top right of your browser, then click
                  the pin next to Amarnai. This box updates on its own once you do.
                </Trans>
              </p>
            </div>
          ) : pinned === "pinned" ? (
            <p className="wc-pin-done" role="status">
              <span className="wc-pin-check" aria-hidden>
                ✓
              </span>
              <Trans>Amarnai is pinned. Its icon opens the panel from any tab.</Trans>
            </p>
          ) : (
            <p className="wc-hint">
              <Trans>Tip: pin the Amarnai icon in your toolbar to keep it one click away.</Trans>
            </p>
          )}
        </div>
      </div>
    </main>
  );
}
