"use client";

import { useMemo } from "react";
import { Trans } from "@lingui/react/macro";
import { useLingui } from "@lingui/react";
import { MockEmailsPage } from "@amarnai/ui/emails";
import { getDemoThreads, getDemoFolders, getDemoDraftBodies } from "@/components/demo/demo-seed";

export function EmailsDemoSection() {
  const { i18n } = useLingui();
  const threads = useMemo(() => getDemoThreads(i18n), [i18n]);
  const folders = useMemo(() => getDemoFolders(i18n), [i18n]);
  const draftBodies = useMemo(() => getDemoDraftBodies(i18n), [i18n]);
  return (
    <section className="ld-demo-section" id="triage">
      <div className="ld-wrap">
        <div className="ld-demo-head ld-reveal">
          <div className="ld-copy">
            <h2 className="ld-section-h">
              <Trans>Every email goes where it belongs.</Trans>
            </h2>
            <p className="ld-section-lede">
              <Trans>
                Every thread lands in one of your folders, exactly where you
                would expect to find it. When a reply is needed, a draft is one
                click away, ready for your edits and never sent without them.
              </Trans>
            </p>
          </div>
        </div>

        <div className="ld-app-frame ld-reveal">
          <div className="ld-frame-bar">
            <div className="ld-crumbs">
              <span><Trans>Acme Workspace</Trans></span>
              <span className="ld-sep">/</span>
              <span className="ld-here"><Trans>Mail</Trans></span>
            </div>
            <div className="ld-play-note">
              <Trans>Click folders &amp; threads, then generate a draft.</Trans>
            </div>
            <div className="ld-sync-chip">
              <span className="ld-sync-dot" />
              <Trans>Synced 2m ago</Trans>
            </div>
          </div>
          <div className="ld-demo-stage emails">
            <MockEmailsPage
              initialThreads={threads}
              initialFolders={folders}
              draftBodies={draftBodies}
              syncInfo={{ lastSyncedAt: new Date().toISOString(), backfillStatus: "IDLE", workspacePlan: "PRO", pushEnabled: true }}
            />
          </div>
        </div>
      </div>
    </section>
  );
}
