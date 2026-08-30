import type { ApiClient } from "@aziru/api-client";
import type { PanelHost } from "../host.js";
import type { WorkspaceEventsDeps } from "./useWorkspaceEvents.js";

/**
 * The event-stream dependencies, built from what every panel host already has.
 *
 * Shared because two hooks need them — the thread view and the queue — and
 * `useWorkspaceEvents` takes its deps as an effect dependency, so an object
 * built inline in two places would be two objects and, eventually, two subtly
 * different ones. Callers still memoize the result on (api, host).
 *
 * `ensureFreshToken` is a plain authenticated ping: the API client owns the
 * single-flight refresh, and a second refresher racing it burns refresh tokens.
 */
export function makePanelSseDeps(api: ApiClient, host: PanelHost): WorkspaceEventsDeps {
  return {
    baseUrl: host.apiBaseUrl,
    ensureFreshToken: async () => {
      await api.me();
    },
    getAccessToken: async () => (await host.tokenStore.get())?.accessToken ?? null,
  };
}
