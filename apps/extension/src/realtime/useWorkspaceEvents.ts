import { useEffect, useRef } from "react";
import type { ApiClient } from "@amarnai/api-client";
import { API_BASE_URL } from "../config";
import { extensionTokenStore } from "../auth/tokenStore";
import { SSEParser } from "./parseSSE";

const INITIAL_BACKOFF_MS = 1_000;
const MAX_BACKOFF_MS = 30_000;

/**
 * Subscribe to the workspace Server-Sent Events stream and call `onSynced`
 * whenever the worker finishes a sync, so the panel can refresh immediately.
 *
 * The panel page (not the MV3 service worker) owns this connection: the worker
 * is killed after ~30s idle and streaming fetches do not keep it alive, whereas
 * the panel document lives as long as the panel is open. The stream is consumed
 * with fetch + ReadableStream + an Authorization header (EventSource cannot send
 * one); host_permissions let the extension page read it cross-origin.
 *
 * Reconnection is manual with exponential backoff, refreshing the access token
 * (via a client.me() ping that piggybacks the transport's single-flight refresh)
 * before each attempt. Gated on document visibility: the socket is dropped when
 * the panel is hidden and re-opened when it becomes visible. Pass `null` for
 * `workspaceId` to disconnect. The web app's counterpart is the EventSource on
 * the emails page; the mobile counterpart is src/realtime/useWorkspaceEvents.ts.
 */
export function useWorkspaceEvents(
  client: ApiClient,
  workspaceId: string | null,
  onSynced: () => void,
): void {
  const onSyncedRef = useRef(onSynced);
  onSyncedRef.current = onSynced;
  const clientRef = useRef(client);
  clientRef.current = client;

  useEffect(() => {
    if (!workspaceId) return;

    let cancelled = false;
    let abort: AbortController | null = null;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
    let backoff = INITIAL_BACKOFF_MS;

    const clearReconnect = () => {
      if (reconnectTimer) {
        clearTimeout(reconnectTimer);
        reconnectTimer = null;
      }
    };

    const close = () => {
      clearReconnect();
      if (abort) {
        abort.abort();
        abort = null;
      }
    };

    const scheduleReconnect = () => {
      clearReconnect();
      const delay = backoff;
      backoff = Math.min(backoff * 2, MAX_BACKOFF_MS);
      reconnectTimer = setTimeout(() => {
        void connect();
      }, delay);
    };

    const connect = async () => {
      if (cancelled || document.visibilityState !== "visible") return;
      close(); // never run more than one live connection

      // Refresh the access token if it has expired by piggybacking on the
      // transport's single-flight 401-refresh, then read the (possibly rotated)
      // token for the connection. A still-valid token makes this a no-op.
      try {
        await clientRef.current.me();
      } catch {
        // A failed ping (e.g. offline) just falls through; we either connect
        // with the current token or hit the error path and back off.
      }
      if (cancelled) return;
      const accessToken = (await extensionTokenStore.get())?.accessToken ?? null;
      if (cancelled || !accessToken) {
        if (!cancelled) scheduleReconnect();
        return;
      }

      const controller = new AbortController();
      abort = controller;

      try {
        const res = await fetch(
          `${API_BASE_URL}/workspaces/${encodeURIComponent(workspaceId)}/events`,
          {
            headers: { Authorization: `Bearer ${accessToken}`, Accept: "text/event-stream" },
            signal: controller.signal,
          },
        );
        if (!res.ok || !res.body) {
          scheduleReconnect();
          return;
        }

        backoff = INITIAL_BACKOFF_MS; // healthy connection
        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        const parser = new SSEParser();

        // Read until the stream ends or is aborted; treat either as a
        // disconnect and reconnect (unless we intentionally aborted).
        for (;;) {
          const { value, done } = await reader.read();
          if (done) break;
          for (const evt of parser.push(decoder.decode(value, { stream: true }))) {
            if (evt.event === "synced") onSyncedRef.current();
          }
        }
        if (!cancelled) scheduleReconnect();
      } catch {
        // AbortError (intentional close) or a network drop. Only reconnect if
        // this was not our own abort.
        if (!cancelled && !controller.signal.aborted) scheduleReconnect();
      }
    };

    const onVisibility = () => {
      if (document.visibilityState === "visible") {
        backoff = INITIAL_BACKOFF_MS;
        void connect();
      } else {
        close();
      }
    };

    void connect();
    document.addEventListener("visibilitychange", onVisibility);

    return () => {
      cancelled = true;
      document.removeEventListener("visibilitychange", onVisibility);
      close();
    };
  }, [client, workspaceId]);
}
