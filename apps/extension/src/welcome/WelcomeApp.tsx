import { useEffect, useRef, useState, type ReactNode } from "react";
import { Trans } from "@lingui/react/macro";
import {
  AziruMark,
  GoogleGIcon,
  MicrosoftIcon,
  ShieldCheckIcon,
} from "@aziru/ui";
import { ext } from "../platform/ext";
import { usePinnedState, type PinState } from "./usePinnedState";
import { WelcomeCarousel } from "./WelcomeCarousel";

/**
 * First-run tab, opened by the background script on install.
 *
 * The left half previews the product with the same three demos the landing
 * page runs; the right half answers the three things a user who arrived
 * straight from the store does not know yet: what Aziru does, where it
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
      <div className="wc-grid">
        <WelcomeCarousel />

        <div className="wc-intro">
          <div className="wc-brand">
            {/* The vector mark, not the shipped PNG: that one is a raster on an
                opaque plate, which renders as a white tile on the dark theme and
                is soft above 48px. */}
            <AziruMark size={36} className="wc-brand-mark" />
            <span className="wc-brand-name">Aziru</span>
          </div>

          <div className="wc-headline">
            <h1 className="wc-title">
              <Trans>Your inbox, already sorted</Trans>
            </h1>
            <p className="wc-lede">
              <Trans>
                Save hours of work every week. Aziru sorts your old and new
                emails, summarizes your threads, and drafts your replies.
              </Trans>
            </p>
          </div>

          {/* In the order they happen. Sign-in used to sit last, after two steps
              nobody can act on until it is done. */}
          <ol className="wc-steps">
            <li className="wc-step">
              <span className="wc-step-num" aria-hidden>
                1
              </span>
              <div>
                <h2 className="wc-step-title">
                  <Trans>Connect your inbox</Trans>
                </h2>
                <p className="wc-step-text">
                  <Trans>
                    One sign-in creates your account and connects Gmail or Outlook.
                    Aziru never sends or deletes mail.
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
                  <Trans>Create your folders</Trans>
                </h2>
                <p className="wc-step-text">
                  <Trans>
                    Let Aziru generate a set that fits your own inbox, or start from a
                    template. One click either way, and you can change them any time.
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
                  <Trans>Work in Gmail or Outlook</Trans>
                </h2>
                <p className="wc-step-text">
                  <Trans>
                    Your folders become Gmail labels / Outlook categories, so sorted
                    mail is waiting in your inbox.
                  </Trans>
                </p>
              </div>
            </li>
          </ol>

          <div className="wc-cta-block">
            <button type="button" className="wc-cta" onClick={openPanel}>
              <AziruMark size={20} />
              <Trans>Open Aziru</Trans>
            </button>

            {/* Both mail providers reviewed Aziru before it could ask for a
                mailbox; saying so under the button is the last thing a
                first-run user wants to know before signing in. */}
            <ul className="wc-assurances">
              <li className="wc-assurance">
                <GoogleGIcon size={14} />
                <Trans>Verified by Google</Trans>
              </li>
              <li className="wc-assurance">
                <MicrosoftIcon size={14} />
                <Trans>Verified by Microsoft</Trans>
              </li>
              <li className="wc-assurance">
                <ShieldCheckIcon size={14} />
                <Trans>CASA Tier 2 certified</Trans>
              </li>
            </ul>
          </div>

          <ToolbarNote pinned={pinned} fallback={fallback} />
        </div>
      </div>
    </main>
  );
}

/**
 * The one thing under the CTA that changes: where the icon is, and whether it
 * is there at all. Every state renders the same box so the slot does not swell
 * into a callout and shrink back to grey small print as the browser answers.
 */
function ToolbarNote({ pinned, fallback }: { pinned: PinState; fallback: boolean }) {
  // Opening the panel failed, so the toolbar icon is the way in and saying so
  // outranks the pin tip — unless there is no icon yet, which the unpinned
  // branch below already explains.
  if (fallback && pinned !== "unpinned") {
    return (
      <Note mark={<PinGlyph />}>
        <Trans>Click the Aziru icon in your toolbar to open the panel.</Trans>
      </Note>
    );
  }

  // Browsers give extensions no way to pin themselves, so this asks, then
  // watches. "unknown" is a browser that will not say (Firefox pins on
  // install), which gets the plain tip instead of a step it cannot pass.
  if (pinned === "unpinned") {
    return (
      <Note
        accent
        mark={<PinGlyph />}
        title={<Trans>Pin Aziru to your toolbar</Trans>}
      >
        <Trans>
          Click the puzzle-piece icon at the top right of your browser, then click the
          pin next to Aziru. This box updates on its own once you do.
        </Trans>
      </Note>
    );
  }

  if (pinned === "pinned") {
    return (
      <Note
        mark={
          <span className="wc-note-check" aria-hidden>
            ✓
          </span>
        }
      >
        <Trans>Aziru is pinned. Its icon opens the panel from any tab.</Trans>
      </Note>
    );
  }

  return (
    <Note mark={<PinGlyph />}>
      <Trans>Tip: pin the Aziru icon in your toolbar to keep it one click away.</Trans>
    </Note>
  );
}

function Note({
  accent = false,
  mark,
  title,
  children,
}: {
  accent?: boolean;
  mark: ReactNode;
  title?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className={`wc-note${accent ? " wc-note--accent" : ""}`} role="status">
      <span className="wc-note-mark" aria-hidden>
        {mark}
      </span>
      <div>
        {title ? <h2 className="wc-note-title">{title}</h2> : null}
        <p className="wc-note-text">{children}</p>
      </div>
    </div>
  );
}

function PinGlyph() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden>
      <path
        d="M9.6 1.9l4.5 4.5-1.6 1.6-1.2-.3-2.9 2.9.2 1.9-1.1 1.1L3 8.5l1.1-1.1 1.9.2 2.9-2.9-.3-1.2zM5.2 10.8L2.4 13.6"
        stroke="currentColor"
        strokeWidth="1.3"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
