import { useCallback, useEffect, useRef, useState } from 'react';
import type { Draft, QuotaInfo } from '@amarnai/api-client';
import type { ThreadItem } from '@amarnai/core';
import { useSession } from '../auth/session';
import { useTriageActions } from '../triage/TriageProvider';

export type DraftState = 'idle' | 'loading' | 'ready' | 'error';

export type UseThreadDraftResult = {
  draftState: DraftState;
  draft: Draft | null;
  quota: QuotaInfo | null;
  generate: (opts?: { force?: boolean }) => void;
  regenerate: () => void;
  toggleSent: () => void;
};

const POLL_INTERVAL_MS = 2_000;

export function useThreadDraft(thread: ThreadItem | null): UseThreadDraftResult {
  const { client, workspaceId } = useSession();
  const { handleDraftStarted, handleDraftFailed, handleDraftGenerated, handleDraftSentToggled } = useTriageActions();

  const [draftState, setDraftState] = useState<DraftState>('idle');
  const [draft, setDraft] = useState<Draft | null>(null);
  const [quota, setQuota] = useState<QuotaInfo | null>(null);

  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const mountedRef = useRef(true);
  // Identifies the active (workspace, thread) context. Every async callback
  // captures the token it was started under and bails via isCurrent() if a newer
  // context has taken over (thread switch, workspace switch, or unmount) — this
  // prevents a late response/poll from overwriting another thread's state.
  const tokenRef = useRef('');

  function clearPoll() {
    if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
  }

  const isCurrent = useCallback(
    (token: string) => mountedRef.current && tokenRef.current === token,
    [],
  );

  // Unmount-only guard: stop any running poll and mark unmounted so in-flight
  // callbacks (including a generate() that resolves after navigation) no-op.
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      clearPoll();
    };
  }, []);

  function startPoll(token: string, threadId: string) {
    if (!workspaceId) return;
    clearPoll(); // never run two intervals at once
    pollRef.current = setInterval(() => {
      if (!isCurrent(token)) {
        clearPoll();
        return;
      }
      client.threadDrafts(workspaceId, threadId).then(({ drafts: polled }) => {
        if (!isCurrent(token)) return;
        const d = polled[0];
        if (d?.status === 'GENERATING') return;
        clearPoll();
        if (d?.status === 'PROPOSED' || d?.status === 'SENT') {
          setDraft(d);
          setDraftState('ready');
          handleDraftGenerated(threadId);
        } else {
          setDraftState('error');
          handleDraftFailed(threadId);
        }
      }).catch(() => {
        if (!isCurrent(token)) return;
        clearPoll();
        setDraftState('error');
        handleDraftFailed(threadId);
      });
    }, POLL_INTERVAL_MS);
  }

  useEffect(() => {
    if (!thread || !workspaceId) return;

    const threadId = thread.id;
    const token = `${workspaceId}::${threadId}`;
    tokenRef.current = token;

    // Reset for the new (workspace, thread) context. Runs on both thread and
    // workspace switches because the effect deps include workspaceId.
    clearPoll();
    setDraft(null);
    setDraftState(thread.isDrafting ? 'loading' : 'idle');
    setQuota(null);

    if (thread.status === 'unsorted') return;

    client.draftQuota(workspaceId).then((q) => {
      if (isCurrent(token)) setQuota(q);
    }).catch(() => {});

    client.threadDrafts(workspaceId, threadId).then(({ drafts }) => {
      if (!isCurrent(token)) return;
      const latest = drafts[0];
      if (latest?.status === 'GENERATING' || (!latest && thread.isDrafting)) {
        setDraftState('loading');
        startPoll(token, threadId);
      } else if (latest?.status === 'PROPOSED' || latest?.status === 'SENT') {
        setDraft(latest);
        setDraftState('ready');
      }
      // !latest && !isDrafting → already 'idle'
    }).catch(() => {});

    return clearPoll;
  }, [thread?.id, workspaceId]);

  const generate = useCallback((opts: { force?: boolean } = {}) => {
    if (!thread || !workspaceId) return;
    const threadId = thread.id;
    const token = `${workspaceId}::${threadId}`;
    const hadDraft = draft !== null;
    setDraftState('loading');
    handleDraftStarted(threadId);

    client.generateDraft(workspaceId, threadId, opts).then((result) => {
      if (!isCurrent(token)) return;
      if ('generating' in result) {
        startPoll(token, threadId);
        return;
      }
      if ('quotaExceeded' in result) {
        // Keep an existing draft visible (with the exhausted banner); otherwise
        // fall back to the idle CTA. Never leave 'ready' with a null draft.
        setDraftState(hadDraft ? 'ready' : 'idle');
        setQuota({ used: result.used, limit: result.limit, resetsAt: result.resetsAt });
        handleDraftFailed(threadId);
        return;
      }
      if ('notClassified' in result) {
        // Thread not sorted yet: nothing to draft against.
        setDraftState('error');
        handleDraftFailed(threadId);
        return;
      }
      setDraft(result.draft);
      setDraftState('ready');
      if (result.isNew) {
        setQuota((q) => q ? { ...q, used: q.used + 1 } : q);
      }
      handleDraftGenerated(threadId);
    }).catch(() => {
      if (!isCurrent(token)) return;
      setDraftState('error');
      handleDraftFailed(threadId);
    });
  }, [thread?.id, workspaceId, draft]);

  const regenerate = useCallback(() => generate({ force: true }), [generate]);

  const toggleSent = useCallback(() => {
    if (!draft || !thread || !workspaceId) return;
    const newSent = draft.status !== 'SENT';
    const optimistic: Draft = { ...draft, status: newSent ? 'SENT' : 'PROPOSED' };
    setDraft(optimistic);
    handleDraftSentToggled(thread.id, newSent);
    client.toggleDraftSent(workspaceId, thread.id, draft.id, newSent)
      .then(({ draft: updated }) => setDraft(updated))
      .catch(() => {
        setDraft(draft);
        handleDraftSentToggled(thread.id, !newSent);
      });
  }, [draft, thread?.id, workspaceId]);

  return { draftState, draft, quota, generate, regenerate, toggleSent };
}
