"use client";

import { Trans } from "@lingui/react/macro";
import { formatQuotaResetDate } from "@amarnai/shared";

/**
 * The thread-preview TL;DR slot, shared by the web app and the extension side
 * panel. Pure presentation: the caller owns fetching, polling, and retries and
 * hands the result in as a single discriminated state.
 *
 * "snippet" is not an error or a fallback — it is the deliberate zero-cost answer
 * for single-message and automated threads, so it is labelled "Preview" rather
 * than "Summary" to stay honest about what the reader is looking at.
 */
export type ThreadSummaryCardState =
  | { kind: "loading" }
  | { kind: "summary"; text: string }
  // Reserved for threads that genuinely enumerate facts (times, places,
  // documents, action items), where prose would flatten the structure away.
  | { kind: "bullets"; bullets: string[] }
  | { kind: "snippet"; text: string }
  | { kind: "error"; onRetry: () => void }
  | { kind: "quota"; quota: { used: number; limit: number; resetsAt: string } };

export interface ThreadSummaryCardProps {
  state: ThreadSummaryCardState;
}

export function ThreadSummaryCard({ state }: ThreadSummaryCardProps) {
  if (state.kind === "loading") {
    return (
      <div className="em-summary-loading">
        <span className="em-summary-skeleton-pulse" aria-hidden />
        <Trans>Summarizing…</Trans>
      </div>
    );
  }

  if (state.kind === "error") {
    return (
      <div className="em-summary-error">
        <span><Trans>Could not summarize this thread.</Trans></span>
        <button type="button" className="em-btn ghost" onClick={state.onRetry}>
          <Trans>Retry</Trans>
        </button>
      </div>
    );
  }

  if (state.kind === "quota") {
    return (
      <p className="em-summary-quota">
        <Trans>
          No summaries remaining this month · resets {formatQuotaResetDate(state.quota.resetsAt)}
        </Trans>
      </p>
    );
  }

  if (state.kind === "bullets") {
    // An empty list is the same nothing-to-show case as an empty snippet.
    if (state.bullets.length === 0) return null;
    return (
      <div className="em-summary-card">
        <div className="em-summary-eyebrow"><Trans>Summary</Trans></div>
        <ul className="em-summary-bullets">
          {state.bullets.map((bullet, i) => (
            <li key={i}>{bullet}</li>
          ))}
        </ul>
      </div>
    );
  }

  // A thread with no stored snippet has nothing to show, and an empty card is
  // worse than no card.
  if (!state.text) return null;

  return (
    <div className="em-summary-card">
      <div className="em-summary-eyebrow">
        {state.kind === "summary" ? <Trans>Summary</Trans> : <Trans>Preview</Trans>}
      </div>
      <p className="em-summary-text">{state.text}</p>
    </div>
  );
}
