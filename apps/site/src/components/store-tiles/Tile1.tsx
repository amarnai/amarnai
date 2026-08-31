"use client";

import { useMemo } from "react";
import { Trans } from "@lingui/react/macro";
import { useLingui } from "@lingui/react";
import { MockEmailsPage } from "@aziru/ui/emails";
import {
  MailboxStage,
  getDemoAziruData,
  getDemoThreads,
  getDemoFolders,
  getDemoMembers,
  DEMO_WORKSPACE_PLAN,
} from "@aziru/ui/demo";
import { TileFrame } from "./TileFrame";

const noop = () => {};

/**
 * Store tile 1 — the default thumbnail: a sorted Gmail inbox. Label chips on
 * every row and the Aziru side panel docked beside the page, the same
 * composition as the landing page's in-your-inbox demo, frozen on the inbox
 * list.
 */
export function Tile1() {
  const { i18n } = useLingui();
  const threads = useMemo(() => getDemoThreads(i18n, "GMAIL"), [i18n]);
  const folders = useMemo(() => getDemoFolders(i18n), [i18n]);
  const aziru = useMemo(() => getDemoAziruData(i18n), [i18n]);
  const members = useMemo(() => getDemoMembers(i18n), [i18n]);

  return (
    <TileFrame
      headline={
        <Trans>
          Open your inbox. <span className="soft">It&apos;s already sorted.</span>
        </Trans>
      }
      provider="gmail"
      panel={
        <MockEmailsPage
          initialThreads={threads}
          initialFolders={folders}
          members={members}
          syncInfo={{
            lastSyncedAt: new Date().toISOString(),
            backfillStatus: "IDLE",
            workspacePlan: DEMO_WORKSPACE_PLAN,
            pushEnabled: true,
          }}
          initialRailOpen={false}
          surface="extension"
        />
      }
    >
      <MailboxStage
        provider="gmail"
        threads={threads}
        folders={folders}
        aziru={aziru}
        openThread={null}
        onOpenThread={noop}
        onCloseThread={noop}
      />
    </TileFrame>
  );
}
