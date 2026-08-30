import { useMemo } from "react";
import type { ApiClient } from "@aziru/api-client";
import {
  useWorkspaceEvents as useSharedWorkspaceEvents,
  type WorkspaceThreadEvent,
} from "@aziru/panel/realtime";
import { API_BASE_URL } from "../config";
import { extensionTokenStore } from "../auth/tokenStore";

export type { WorkspaceThreadEvent };

/**
 * The side panel's binding of the shared workspace event stream.
 *
 * The reconnect loop, framing, and visibility gating live in @aziru/panel so
 * the side panel and the panel injected into Gmail/Outlook cannot drift; what is
 * extension-specific is only where the tokens live and how they are refreshed.
 *
 * The panel page (not the MV3 service worker) owns this connection: the worker
 * is killed after ~30s idle and streaming fetches do not keep it alive, whereas
 * the panel document lives as long as the panel is open. host_permissions let
 * the extension page read the stream cross-origin.
 *
 * `client.me()` is the refresh: a cheap authenticated ping that piggybacks the
 * transport's single-flight 401-refresh, so this never runs a second refresher
 * against the same tokens. Pass `null` for `workspaceId` to disconnect.
 */
export function useWorkspaceEvents(
  client: ApiClient,
  workspaceId: string | null,
  onSynced: () => void,
  onThreadEvent?: (event: WorkspaceThreadEvent) => void,
): void {
  // Memoized on `client`: the shared hook reconnects when this changes, which is
  // exactly the case that needs it (a new session means new tokens).
  const deps = useMemo(
    () => ({
      baseUrl: API_BASE_URL,
      ensureFreshToken: async () => {
        await client.me();
      },
      getAccessToken: async () => (await extensionTokenStore.get())?.accessToken ?? null,
    }),
    [client],
  );

  useSharedWorkspaceEvents(
    deps,
    workspaceId,
    onThreadEvent ? { onSynced, onThreadEvent } : { onSynced },
  );
}
