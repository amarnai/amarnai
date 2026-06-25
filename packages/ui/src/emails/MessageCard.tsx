"use client";

import { useState } from "react";
import { Trans } from "@lingui/react/macro";
import type { ThreadMessage } from "./types.js";

function fmtDateTime(d: Date): string {
  const crossYear = d.getFullYear() !== new Date().getFullYear();
  return d.toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    ...(crossYear ? { year: "numeric" } : {}),
    hour: "2-digit",
    minute: "2-digit",
  });
}

export interface MessageCardProps {
  message: ThreadMessage;
  defaultExpanded?: boolean;
  loading?: boolean;
}

export function MessageCard({ message, defaultExpanded = false, loading = false }: MessageCardProps) {
  const [expanded, setExpanded] = useState(defaultExpanded);

  return (
    <div className={`em-msg-card${expanded ? " open" : ""}`}>
      <button
        type="button"
        className="em-msg-header"
        onClick={() => setExpanded((v) => !v)}
        aria-expanded={expanded}
      >
        <span className="em-msg-from">{message.fromName || message.fromEmail}</span>
        {!expanded && message.snippet && (
          <span className="em-msg-snippet">{message.snippet}</span>
        )}
        <span className="em-msg-time">{fmtDateTime(message.time)}</span>
        <svg
          className="em-msg-chevron"
          width="10"
          height="10"
          viewBox="0 0 10 10"
          fill="none"
          aria-hidden
        >
          <path d="M2.5 4l2.5 2.5L7.5 4" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>

      {expanded && (
        <div className="em-msg-body">
          {message.fromEmail !== message.fromName && (
            <div className="em-msg-from-email">{message.fromEmail}</div>
          )}
          {message.bodyText ? (
            <pre className="em-msg-text">{message.bodyText}</pre>
          ) : loading ? (
            <p className="em-msg-text em-msg-loading"><Trans>Loading…</Trans></p>
          ) : message.snippet ? (
            <p className="em-msg-text">{message.snippet}</p>
          ) : (
            <p className="em-msg-text em-msg-empty"><Trans>(No body)</Trans></p>
          )}
          {message.attachments && message.attachments.length > 0 && (
            <div className="em-attachment-list">
              {message.attachments.map((a, i) => (
                <span key={`${a.filename ?? a.mimeType}-${i}`} className="em-attachment-chip">
                  <svg width="11" height="11" viewBox="0 0 12 12" fill="none" aria-hidden>
                    <path d="M10 5.5 6 9.5a3 3 0 01-4.24-4.24L6.5 1a2 2 0 012.83 2.83L4.58 8.58a1 1 0 01-1.41-1.41L8 2.5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round"/>
                  </svg>
                  {a.filename ?? a.mimeType}
                </span>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
