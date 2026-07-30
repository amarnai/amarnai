import { useMemo } from "react";
import { InjectedThreadPanel } from "@amarnai/panel";
import { WEB_APP_URL } from "../config";
import { createInjectedPanelHost } from "./panelHost";

/**
 * The whole of the injected iframe's UI.
 *
 * Everything of substance is in @amarnai/panel, shared with the Outlook task
 * pane. What lives here is the one thing that cannot be shared: the host built
 * on this frame's postMessage link to the mail page that embedded it, whether
 * that is Gmail's sidebar or OWA's drawer.
 */
export function InjectedApp() {
  // Built once: the host owns the postMessage listener and the ready handshake,
  // and a second instance would double both.
  const host = useMemo(() => createInjectedPanelHost(), []);
  return <InjectedThreadPanel host={host} webAppUrl={WEB_APP_URL} />;
}
