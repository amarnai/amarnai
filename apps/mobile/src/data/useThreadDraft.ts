import { useCallback, useEffect, useRef, useState } from 'react';
import type { Draft, QuotaInfo } from '@amarnai/api-client';
import type { ThreadItem } from '@amarnai/core';
import { useSession } from '../auth/session';
import { useTriage } from '../triage/TriageProvider';

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
  const triage = useTriage();

  const [draftState, setDraftState] = useState<DraftState>('idle');
  const [draft, setDraft] = useState<Draft | null>(null);
  const [quota, setQuota] = useState<QuotaInfo | null>(null);

  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const threadIdRef = useRef<string | null>(null);

  function clearPoll() {
    if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
  }

  function startPoll(threadId: string) {
    if (!workspaceId) return;
    pollRef.current = setInterval(() => {
      client.threadDrafts(workspaceId, threadId).then(({ drafts: polled }) => {
        const d = polled[0];
        if (d?.status === 'GENERATING') return;
        clearPoll();
        if (d?.status === 'PROPOSED' || d?.status === 'SENT') {
          setDraft(d);
          setDraftState('ready');
          triage.handleDraftGenerated(threadId);
        } else {
          setDraftState('error');
          triage.handleDraftFailed(threadId);
        }
      }).catch(() => {
        clearPoll();
        setDraftState('error');
        if (thread) triage.handleDraftFailed(thread.id);
      });
    }, POLL_INTERVAL_MS);
  }

  useEffect(() => {
    if (!thread || !workspaceId) return;

    // Reset whenever we switch threads.
    if (threadIdRef.current !== thread.id) {
      threadIdRef.current = thread.id;
      clearPoll();
      setDraft(null);
      setDraftState(thread.isDrafting ? 'loading' : 'idle');
    }

    if (thread.status === 'unsorted') return;

    const threadId = thread.id;
    client.draftQuota(workspaceId).then(setQuota).catch(() => {});

    client.threadDrafts(workspaceId, threadId).then(({ drafts }) => {
      const latest = drafts[0];
      if (latest?.status === 'GENERATING' || (!latest && thread.isDrafting)) {
        setDraftState('loading');
        startPoll(threadId);
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
    setDraftState('loading');
    triage.handleDraftStarted(threadId);

    client.generateDraft(workspaceId, threadId, opts).then((result) => {
      if ('generating' in result) {
        startPoll(threadId);
        return;
      }
      if ('quotaExceeded' in result) {
        setDraftState(opts.force ? 'ready' : 'idle');
        setQuota({ used: result.used, limit: result.limit, resetsAt: result.resetsAt });
        triage.handleDraftFailed(threadId);
        return;
      }
      setDraft(result.draft);
      setDraftState('ready');
      if (result.isNew) {
        setQuota((q) => q ? { ...q, used: q.used + 1 } : q);
      }
      triage.handleDraftGenerated(threadId);
    }).catch(() => {
      setDraftState('error');
      triage.handleDraftFailed(threadId);
    });
  }, [thread?.id, workspaceId]);

  const regenerate = useCallback(() => generate({ force: true }), [generate]);

  const toggleSent = useCallback(() => {
    if (!draft || !thread || !workspaceId) return;
    const newSent = draft.status !== 'SENT';
    const optimistic: Draft = { ...draft, status: newSent ? 'SENT' : 'PROPOSED' };
    setDraft(optimistic);
    triage.handleDraftSentToggled(thread.id, newSent);
    client.toggleDraftSent(workspaceId, thread.id, draft.id, newSent)
      .then(({ draft: updated }) => setDraft(updated))
      .catch(() => {
        setDraft(draft);
        triage.handleDraftSentToggled(thread.id, !newSent);
      });
  }, [draft, thread?.id, workspaceId]);

  return { draftState, draft, quota, generate, regenerate, toggleSent };
}
