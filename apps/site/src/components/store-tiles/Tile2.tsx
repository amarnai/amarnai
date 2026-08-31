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
 * Store tile 2 — an open Outlook conversation with the injected summary card
 * at the top. t6 is the one demo thread with a bullet-point TL;DR, which is
 * the card at its best. Outlook here (Gmail on tiles 1 and 3) so the tile row
 * shows both providers without spending a slot on saying so.
 */
export function Tile2() {
  const { i18n } = useLingui();
  const threads = useMemo(() => getDemoThreads(i18n, "OUTLOOK"), [i18n]);
  const folders = useMemo(() => getDemoFolders(i18n), [i18n]);
  const aziru = useMemo(() => getDemoAziruData(i18n), [i18n]);
  const openThread = threads.find((t) => t.id === "t6") ?? null;

  return (
    <TileFrame
      headline={
        <Trans>
          Every thread opens <span className="soft">with a summary.</span>
        </Trans>
      }
      provider="outlook"
    >
      <MailboxStage
        provider="outlook"
        threads={threads}
        folders={folders}
        aziru={aziru}
        openThread={openThread}
        onOpenThread={noop}
        onCloseThread={noop}
      />
    </TileFrame>
  );
}
