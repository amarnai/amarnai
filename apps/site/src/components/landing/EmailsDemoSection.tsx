"use client";

import { MockEmailsPage } from "@amarnai/ui/emails";
import { DEMO_THREADS, DEMO_FOLDERS } from "@/components/demo/demo-seed";

export function EmailsDemoSection() {
  return (
    <section className="ld-demo-section" id="triage">
      <div className="ld-wrap">
        <div className="ld-demo-head ld-reveal">
          <div className="ld-copy">
            <h2 className="ld-section-h">Triage that explains itself.</h2>
            <p className="ld-section-lede">
              Browse folders, open a thread, and read why Amarnai routed it
              there. When a reply is needed, press{" "}
              <strong>Generate draft reply</strong> — a draft appears instantly,
              ready for your edits. This is the real interface.
            </p>
          </div>
          <div className="ld-play-note">
            <span className="ld-play-dot" />
            Click folders &amp; threads, then generate a draft.
          </div>
        </div>

        <div className="ld-app-frame ld-reveal">
          <div className="ld-frame-bar">
            <div className="ld-crumbs">
              <span>Acme Workspace</span>
              <span className="ld-sep">/</span>
              <span className="ld-here">Mail</span>
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
              syncInfo={{ lastSyncedAt: new Date().toISOString(), backfillStatus: "IDLE", workspacePlan: "PRO" }}
            />
          </div>
        </div>
      </div>
    </section>
  );
}
