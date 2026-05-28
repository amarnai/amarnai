"use client";

import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import type { FolderItem, ThreadItem } from "./selection";
import { RationaleCard } from "./RationaleCard";
import { MessageCard } from "./MessageCard";
import { SuggestedDraftCard } from "./SuggestedDraftCard";

type Props = {
  thread: ThreadItem;
  folders: FolderItem[];
  workspaceId: string;
  onApprove: (threadId: string) => void;
  onReroute: (threadId: string, anchor: HTMLElement) => void;
  onClose: () => void;
};

export function ThreadPreview({
  thread,
  folders,
  workspaceId,
  onApprove,
  onReroute,
  onClose,
}: Props) {
  const [reasoning, setReasoning] = useState<string | null>(thread.reasoning);
  const [bodyLoaded, setBodyLoaded] = useState(false);
  const [messages, setMessages] = useState(thread.messages);

  useEffect(() => {
    if (bodyLoaded) return;
    setBodyLoaded(false);
    api.emailThread(workspaceId, thread.id).then((detail) => {
      setReasoning(detail.latestClassification?.explanation ?? null);
      setMessages(
        detail.messages.map((m) => ({
          id: m.id,
          fromName: m.senderName ?? m.senderEmail,
          fromEmail: m.senderEmail,
          time: new Date(m.receivedAt),
          snippet: m.snippet,
          bodyText: m.bodyText,
        }))
      );
      setBodyLoaded(true);
    }).catch(() => {
      setBodyLoaded(true);
    });
  }, [thread.id, workspaceId]);

  const enrichedThread = { ...thread, reasoning };

  return (
    <div className="em-preview-col">
      <div className="em-preview-toolbar">
        <span className="em-preview-spacer" />
        <button
          type="button"
          className="em-icon-btn"
          title="Close preview"
          aria-label="Close preview"
          onClick={onClose}
        >
          <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden>
            <path d="M2 2l8 8M10 2l-8 8" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
          </svg>
        </button>
      </div>

      <div className="em-preview-scroll">
        <h2 className="em-preview-subject">{thread.subject}</h2>

        <RationaleCard
          thread={enrichedThread}
          folders={folders}
          onApprove={() => onApprove(thread.id)}
          onReroute={(anchor) => onReroute(thread.id, anchor)}
        />

        <div className="em-msg-list">
          {messages.map((msg, i) => (
            <MessageCard
              key={msg.id}
              message={msg}
              defaultExpanded={i === messages.length - 1}
            />
          ))}
        </div>

        {thread.suggestedDraft && (
          <SuggestedDraftCard draft={thread.suggestedDraft} />
        )}
      </div>
    </div>
  );
}
