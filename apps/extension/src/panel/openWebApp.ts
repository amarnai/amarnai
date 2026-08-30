import { useCallback } from "react";
import type { MouseEvent } from "react";
import type { ApiClient } from "@aziru/api-client";
import { useSession } from "../auth/session";
import { ext } from "../platform/ext";
import { WEB_APP_URL } from "../config";

/** Build the bridged URL for a web-app path, falling back to the plain one. */
async function bridgedUrl(api: ApiClient, path: string): Promise<string> {
  try {
    const { code } = await api.createBridgeCode();
    return `${WEB_APP_URL}/auth/bridge?code=${encodeURIComponent(code)}&next=${encodeURIComponent(path)}`;
  } catch {
    // A dead API costs a sign-in, not a dead end: the plain URL still works.
    return `${WEB_APP_URL}${path}`;
  }
}

/**
 * Opens a web-app page from the panel, carrying the panel's signed-in user with
 * it. The panel authenticates with an API access token and the web app with its
 * own cookie session, so without this a link out lands on the sign-in form even
 * though the user is already signed in here.
 *
 * A one-time code is minted per click and handed to the web bridge, which
 * exchanges it for a web session and continues to `path`. Minting failures are
 * not surfaced: the plain URL still opens, which is exactly the behaviour these
 * links had before, so a dead API costs a sign-in rather than a dead end.
 */
export async function openWebApp(api: ApiClient, path: string): Promise<void> {
  window.open(await bridgedUrl(api, path), "_blank", "noopener");
}

/**
 * Same, but through the tabs API so the caller keeps the tab's id and can close
 * it later. A page cannot reliably close itself once it has navigated across
 * origins, which a checkout tab always does (bridge, then Stripe, then back), so
 * owning the id here is the only dependable way to tidy it up afterwards.
 *
 * Returns null when the id is unavailable, in which case the tab is still open
 * and the user closes it themselves.
 */
export async function openWebAppTab(api: ApiClient, path: string): Promise<number | null> {
  const url = await bridgedUrl(api, path);
  try {
    const tab = await ext.tabs.create({ url });
    return tab.id ?? null;
  } catch {
    window.open(url, "_blank", "noopener");
    return null;
  }
}

/**
 * Props for a link out to the web app. The anchor keeps a real `href` so
 * middle-click and "open in new tab" still work (they land on the sign-in page,
 * as before); a plain left click is intercepted and routed through the bridge.
 */
export type WebAppLinkProps = {
  href: string;
  target: "_blank";
  rel: string;
  onClick: (e: MouseEvent<HTMLAnchorElement>) => void;
};

export function useWebAppLink(): (path: string) => WebAppLinkProps {
  const { client } = useSession();

  return useCallback(
    (path: string): WebAppLinkProps => ({
      href: `${WEB_APP_URL}${path}`,
      target: "_blank",
      rel: "noopener noreferrer",
      onClick: (e) => {
        // Leave modified clicks to the browser: the user asked for a specific
        // window behaviour and the plain href honours it.
        if (e.defaultPrevented || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
        e.preventDefault();
        void openWebApp(client, path);
      },
    }),
    [client]
  );
}
