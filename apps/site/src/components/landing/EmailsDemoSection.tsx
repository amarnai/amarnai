"use client";

import { MockEmailsPage } from "@amarnai/ui/emails";
import { DEMO_THREADS, DEMO_FOLDERS, DEMO_DRAFT_BODIES } from "@/components/demo/demo-seed";

export function EmailsDemoSection() {
  return (
    <section className="ld-demo-section" id="triage">
      <div className="ld-wrap">
        <div className="ld-demo-head ld-reveal">
          <div className="ld-copy">
            <h2 className="ld-section-h">Every email goes where it belongs.</h2>
            <p className="ld-section-lede">
              Every thread lands in one of your folders, exactly where
              you would expect to find it. When a reply is needed, a draft
              is one click away, ready for your edits and never sent
              without them.
            </p>
          </div>
        </div>

        <div className="ld-app-frame ld-reveal">
          <div className="ld-frame-bar">
            <div className="ld-crumbs">
              <span>Acme Workspace</span>
              <span className="ld-sep">/</span>
              <span className="ld-here">Mail</span>
            </div>
            <div className="ld-play-note">
              Click folders &amp; threads, then generate a draft.
            </div>
            <div className="ld-sync-chip">
              <span className="ld-sync-dot" />
              Synced 2m ago
            </div>
          </div>
          <div className="ld-demo-stage emails">
            <MockEmailsPage
              initialThreads={DEMO_THREADS}
              initialFolders={DEMO_FOLDERS}
              draftBodies={DEMO_DRAFT_BODIES}
              syncInfo={{ lastSyncedAt: new Date().toISOString(), backfillStatus: "IDLE", workspacePlan: "PRO", pushEnabled: true }}
            />
          </div>
        </div>
      </div>
    </section>
  );
}
