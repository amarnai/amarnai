import { useCallback } from "react";
import type { MouseEvent } from "react";
import type { ApiClient } from "@amarnai/api-client";
import { useSession } from "../auth/session";
import { WEB_APP_URL } from "../config";

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
  const target = `${WEB_APP_URL}${path}`;
  let url = target;

  try {
    const { code } = await api.createBridgeCode();
    url = `${WEB_APP_URL}/auth/bridge?code=${encodeURIComponent(code)}&next=${encodeURIComponent(path)}`;
  } catch {
    // Fall through to the plain URL.
  }

  window.open(url, "_blank", "noopener");
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
