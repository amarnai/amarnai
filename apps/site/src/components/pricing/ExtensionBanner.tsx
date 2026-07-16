import { Trans } from "@lingui/react/macro";
import { InstallExtensionButton } from "../landing/InstallExtensionButton";
import styles from "./ExtensionBanner.module.css";
// `InstallExtensionButton` renders with the shared `.ld-btn` / `.ld-ext-btn`
// classes defined in landing.css, so this component pulls that stylesheet in
// the same way the support page does. landing.css uses only `.ld-`-prefixed
// selectors, so it cannot leak into the pricing layout.
import "@/app/landing.css";

/**
 * Marketing band for the browser extension, slotted between the plan cards and
 * the comparison table on the pricing page. The extension is the access surface
 * for Amarnai on every tier, not a plan feature, so it sits on its own rather
 * than inside a card. Desktop-only: the whole band is hidden on narrow
 * viewports since extensions can't install on mobile.
 */
export function ExtensionBanner() {
  return (
    <section className={styles.extStrip} aria-label="Browser extension">
      <img
        src="/logo.png"
        alt=""
        aria-hidden="true"
        className={styles.extIcon}
      />
      <div className={styles.extText}>
        <h2 className={styles.extHeading}>
          <Trans>Amarnai lives in your inbox.</Trans>
        </h2>
        <p className={styles.extCopy}>
          <Trans>
            Install the free browser extension and start triaging right inside
            Gmail or Outlook.
          </Trans>
        </p>
      </div>
      <InstallExtensionButton variant="primary" className={styles.extCta} />
    </section>
  );
}
