"use client";

import { useMemo } from "react";
import { Trans } from "@lingui/react/macro";
import { useLingui } from "@lingui/react";
import {
  MailboxStage,
  getDemoAziruData,
  getDemoThreads,
  getDemoFolders,
} from "@aziru/ui/demo";
import { TileFrame } from "./TileFrame";

const noop = () => {};

/**
 * Store tile 3 — Aziru Reply in Gmail, frozen on a finished draft: the
 * generated text sitting in Gmail's own compose, under Gmail's own Send
 * button, waiting for the user. t3 is the pick because its single short
 * message keeps the compose above the tile's fold.
 */
export function Tile3() {
  const { i18n } = useLingui();
  const threads = useMemo(() => getDemoThreads(i18n, "GMAIL"), [i18n]);
  const folders = useMemo(() => getDemoFolders(i18n), [i18n]);
  const aziru = useMemo(() => getDemoAziruData(i18n), [i18n]);
  const openThread = threads.find((t) => t.id === "t3") ?? null;

  return (
    <TileFrame
      headline={
        <Trans>
          <span className="soft">Draft in one click.</span> You approve and send.
        </Trans>
      }
      provider="gmail"
      className="st-tile-reply"
    >
      <MailboxStage
        provider="gmail"
        threads={threads}
        folders={folders}
        aziru={aziru}
        openThread={openThread}
        onOpenThread={noop}
        onCloseThread={noop}
        initialReplyStage="ready"
      />
    </TileFrame>
  );
}
