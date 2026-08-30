import { useEffect, useRef } from "react";
import { SSEParser } from "./parseSSE.js";
import { parseThreadEvent, type WorkspaceThreadEvent } from "./threadEvent.js";

const INITIAL_BACKOFF_MS = 1_000;
const MAX_BACKOFF_MS = 30_000;

/**
 * What a host has to supply to hold a workspace event stream open.
 *
 * `ensureFreshToken` exists because refreshing must not be this hook's business:
 * every consumer already owns an API client with a single-flight 401-refresh,
 * and a second refresher racing it burns refresh tokens. Consumers pass a cheap
 * authenticated ping (client.me()) and the transport does the rest.
 */
export type WorkspaceEventsDeps = {
  baseUrl: string;
  ensureFreshToken: () => Promise<void>;
  getAccessToken: () => Promise<string | null>;
};

// `deps` participates in the effect's dependency list, so callers must memoize
// it: a new object every render would tear the stream down and reopen it every
// render. In exchange, swapping the API client (a sign-out and back in) does
// reconnect, which is the behaviour that matters.

export type WorkspaceEventHandlers = {
  onSynced?: () => void;
  onThreadEvent?: (event: WorkspaceThreadEvent) => void;
};

/**
 * Subscribe to a workspace's Server-Sent Events stream.
 *
 * Shared by every long-lived Aziru surface outside the web app: the extension
 * side panel and the panel injected into Gmail/Outlook. The stream is consumed
 * with fetch + ReadableStream + an Authorization header (EventSource cannot send
 * one) rather than EventSource, which is why the framing (SSEParser) and the
 * reconnect loop are hand-rolled here.
 *
 * Reconnection is manual with exponential backoff, refreshing the access token
 * before each attempt. The connection is dropped whenever the surface is not
 * actually on screen and reopened when it comes back: `enabled` covers hosts
 * that can be hidden without the document changing state (a collapsed Gmail
 * sidebar), and document visibility covers a backgrounded tab. Pass null for
 * `workspaceId` to disconnect.
 */
export function useWorkspaceEvents(
  deps: WorkspaceEventsDeps,
  workspaceId: string | null,
  handlers: WorkspaceEventHandlers,
  enabled = true,
): void {
  const handlersRef = useRef(handlers);
  handlersRef.current = handlers;
  const depsRef = useRef(deps);
  depsRef.current = deps;

  useEffect(() => {
    if (!workspaceId || !enabled) return;

    let cancelled = false;
    let abort: AbortController | null = null;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
    let backoff = INITIAL_BACKOFF_MS;
    // Monotonic id for the current connect attempt. `close()` bumps it so any
    // in-flight connect that is still suspended before it created its
    // AbortController (i.e. cannot yet be aborted) sees it is superseded and
    // bails after its next await, rather than opening a second live stream.
    let generation = 0;

    const clearReconnect = () => {
      if (reconnectTimer) {
        clearTimeout(reconnectTimer);
        reconnectTimer = null;
      }
    };

    const close = () => {
      clearReconnect();
      // Supersede any in-flight connect, including one still awaiting the token
      // refresh that has not yet stored a controller to abort.
      generation++;
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
      // Claim this attempt. If another connect() (or a close()) runs while we
      // are suspended on an await below, `generation` moves on and the stale
      // checks bail us out before we open a second stream.
      const myGeneration = generation;

      try {
        await depsRef.current.ensureFreshToken();
      } catch {
        // A failed ping (e.g. offline) just falls through; we either connect
        // with the current token or hit the error path and back off.
      }
      if (cancelled || myGeneration !== generation) return;
      const accessToken = await depsRef.current.getAccessToken();
      if (cancelled || myGeneration !== generation) return;
      if (!accessToken) {
        scheduleReconnect();
        return;
      }

      const controller = new AbortController();
      abort = controller;

      try {
        const res = await fetch(
          `${depsRef.current.baseUrl}/workspaces/${encodeURIComponent(workspaceId)}/events`,
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
            if (evt.event === "synced") handlersRef.current.onSynced?.();
            else if (evt.event === "thread" && handlersRef.current.onThreadEvent) {
              const threadEvent = parseThreadEvent(evt.data);
              if (threadEvent) handlersRef.current.onThreadEvent(threadEvent);
            }
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
  }, [deps, workspaceId, enabled]);
}
