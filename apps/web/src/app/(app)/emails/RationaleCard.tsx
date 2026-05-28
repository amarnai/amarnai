import type { FolderItem, ThreadItem } from "./selection";

type Props = {
  thread: ThreadItem;
  folders: FolderItem[];
  onApprove: () => void;
  onReroute: (anchor: HTMLElement) => void;
};

export function RationaleCard({ thread, folders, onApprove, onReroute }: Props) {
  const folder = folders.find((f) => f.id === thread.folderId);
  const unrouted = !folder;
  const confPct = Math.round(thread.confidence * 100);
  const altFolder = thread.alternativeFolder
    ? folders.find((f) => f.id === thread.alternativeFolder?.folderId)
    : null;

  return (
    <div className={`em-rationale-card${unrouted ? " unrouted" : ""}`}>
      <div className="em-rationale-header">
        <span className="em-rationale-label">AI Routing</span>
        <span className="em-rationale-conf">{confPct}% confidence</span>
      </div>

      <div className="em-rationale-dest">
        {unrouted ? (
          <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden>
            <circle cx="6" cy="6" r="5" stroke="currentColor" strokeWidth="1.2" />
            <path d="M6 5.5v3M6 3.5h.01" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
          </svg>
        ) : (
          <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden>
            <path d="M1.2 3.2h2.4l.8-.9h4.4v5.6H1.2V3.2z" stroke="currentColor" strokeWidth="1.1" strokeLinejoin="round" />
          </svg>
        )}
        <span>{folder?.name ?? "Unrouted"}</span>
      </div>

      {thread.reasoning && (
        <div className="em-rationale-reason">{thread.reasoning}</div>
      )}

      {altFolder && thread.alternativeFolder && (
        <div className="em-rationale-alt">
          Runner-up: <strong>{altFolder.name}</strong>
          {" "}({Math.round(thread.alternativeFolder.weight * 100)}%)
        </div>
      )}

      <div className="em-rationale-actions">
        {thread.status !== "sorted" && !unrouted && (
          <button
            type="button"
            className="em-btn-primary"
            onClick={onApprove}
          >
            <svg width="10" height="10" viewBox="0 0 10 10" fill="none" aria-hidden style={{ verticalAlign: -1, marginRight: 4 }}>
              <path d="M1.5 5l2.2 2.5L8.5 2" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            Approve routing
          </button>
        )}
        <button
          type="button"
          className="em-btn-secondary"
          onClick={(e) => onReroute(e.currentTarget)}
        >
          Move to…
        </button>
      </div>
    </div>
  );
}
