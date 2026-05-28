import type { ActiveSelection, FolderItem, ThreadItem } from "./selection";

const FOLDER_ICO = (
  <svg width="10" height="10" viewBox="0 0 10 10" fill="none" aria-hidden>
    <path d="M1.2 3.2h2.4l.8-.9h4.4v5.6H1.2V3.2z" stroke="currentColor" strokeWidth="1.1" strokeLinejoin="round" />
  </svg>
);

function fmtTime(d: Date, today: string): string {
  const ds = d.toISOString().slice(0, 10);
  if (ds === today) {
    return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
  }
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

type Props = {
  thread: ThreadItem;
  folder: FolderItem | undefined;
  active: ActiveSelection;
  selected: boolean;
  onSelect: () => void;
};

export function ThreadRow({ thread, folder, active, selected, onSelect }: Props) {
  const today = new Date().toISOString().slice(0, 10);
  const confPct = Math.round(thread.confidence * 100);
  const confColor =
    thread.confidence >= 0.8
      ? "var(--ok)"
      : thread.confidence >= 0.6
        ? "var(--warn)"
        : "var(--danger)";

  const inExactFolder =
    active.kind === "folder" &&
    active.id === thread.folderId &&
    thread.status !== "review";

  const chipLabel = thread.status === "review"
    ? `Wants ${folder?.name ?? "—"}`
    : (folder?.name ?? "—");

  const chipClass =
    thread.status === "review" ? "em-route-chip needs-review" : "em-route-chip";

  const classes = [
    "em-thread-row",
    thread.unread ? "unread" : "",
    selected ? "selected" : "",
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <div
      className={classes}
      tabIndex={0}
      onClick={onSelect}
      onKeyDown={(e) => e.key === "Enter" && onSelect()}
      role="row"
    >
      <div className="em-thread-main">
        <div className="em-thread-top">
          <span className="em-thread-from">{thread.participants}</span>
          {thread.messageCount > 1 && (
            <span className="em-msg-count">{thread.messageCount}</span>
          )}
        </div>
        <div className="em-thread-subject">{thread.subject}</div>
        {thread.snippet && (
          <div className="em-thread-snippet">{thread.snippet}</div>
        )}
        <div className="em-thread-meta-row">
          {!inExactFolder && folder && (
            <span className={chipClass}>
              <span className="em-chip-ico">{FOLDER_ICO}</span>
              {chipLabel}
            </span>
          )}
          <span className="em-conf">
            <span
              className="em-donut"
              style={
                {
                  "--em-conf": thread.confidence,
                  "--em-conf-c": confColor,
                } as React.CSSProperties
              }
            />
            {confPct}%
          </span>
          {thread.suggestedDraft && (
            <span className="em-pill accent">draft</span>
          )}
        </div>
      </div>

      <div className="em-thread-side">
        <div className="em-thread-time">{fmtTime(thread.latestAt, today)}</div>
      </div>
    </div>
  );
}
