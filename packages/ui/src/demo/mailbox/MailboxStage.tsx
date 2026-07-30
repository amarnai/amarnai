"use client";

import { useMemo } from "react";
import type { ThreadItem } from "../../emails/types.js";
import type { FolderItem } from "../../folder-tree/types.js";
import { GmailInboxMock } from "./GmailInboxMock.js";
import { OutlookInboxMock } from "./OutlookInboxMock.js";
import { MailThreadMock } from "./MailThreadMock.js";
import type { AmarnaiDemoData, MockProvider } from "./types.js";

/**
 * One mailbox, with or without Amarnai in it.
 *
 * This is the whole in-your-inbox demo: a Gmail or Outlook window showing the
 * demo threads, plus everything the extension injects into it (folder labels,
 * the summary card, the Amarnai Reply entry point, the panel in the right
 * rail). Pass `amarnai: null` and the same threads render as the untouched
 * mailbox, which is the comparison the landing page's switch drives.
 *
 * The landing page frames this in simulated browser chrome; the extension's
 * first-run tab renders it bare, because that tab is already open in a real
 * browser and a second painted one two inches away would only confuse.
 *
 * The open thread is the caller's state, not this component's, so the landing
 * page's side panel can open a thread here through its "Open in <provider>"
 * button. Callers with nothing else driving it can hold it in a local useState.
 */
export function MailboxStage({
  provider,
  threads,
  folders,
  amarnai,
  openThread,
  onOpenThread,
  onCloseThread,
}: {
  provider: MockProvider;
  threads: ThreadItem[];
  folders: FolderItem[];
  amarnai: AmarnaiDemoData | null;
  openThread: ThreadItem | null;
  onOpenThread: (thread: ThreadItem) => void;
  onCloseThread: () => void;
}) {
  const folderNames = useMemo(
    () => Object.fromEntries(folders.map((f) => [f.id, f.name])),
    [folders],
  );

  if (openThread) {
    return (
      <MailThreadMock
        provider={provider}
        thread={openThread}
        amarnai={amarnai}
        folderName={folderNames[openThread.folderId ?? ""] ?? ""}
        onBack={onCloseThread}
      />
    );
  }

  return provider === "outlook" ? (
    <OutlookInboxMock threads={threads} amarnai={amarnai} onOpenThread={onOpenThread} />
  ) : (
    <GmailInboxMock threads={threads} amarnai={amarnai} onOpenThread={onOpenThread} />
  );
}
