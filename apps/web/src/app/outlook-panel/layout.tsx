import type { ReactNode } from "react";
import Script from "next/script";
import { notFound } from "next/navigation";
import { isOutlookAddinEnabled, OFFICE_JS_ORIGIN } from "@/lib/outlook-addin";

export const metadata = {
  title: "Aziru",
  robots: { index: false, follow: false },
};

/**
 * Task-pane shell. office.js has to be present before the pane calls
 * Office.onReady, and it must come from Microsoft's CDN — the add-in does not
 * work with a self-hosted copy. `beforeInteractive` puts it ahead of the pane's
 * own bundle; the CSP exception that permits it is scoped to this route in
 * lib/csp.ts.
 *
 * The whole route 404s when the add-in is not enabled for this deployment, so a
 * self-host that never turns it on exposes no framable page at all.
 */
export default function OutlookPanelLayout({ children }: { children: ReactNode }) {
  if (!isOutlookAddinEnabled()) notFound();

  return (
    <>
      <Script src={`${OFFICE_JS_ORIGIN}/lib/1/hosted/office.js`} strategy="beforeInteractive" />
      {children}
    </>
  );
}
