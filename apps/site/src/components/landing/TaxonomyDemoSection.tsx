import { DemoTaxonomyCanvas } from "@/components/demo/DemoTaxonomyCanvas";

export function TaxonomyDemoSection() {
  return (
    <section className="ld-demo-section" id="taxonomy">
      <div className="ld-wrap">
        <div className="ld-demo-head ld-reveal">
          <div className="ld-copy">
            <h2 className="ld-section-h">Shape how your inbox thinks.</h2>
            <p className="ld-section-lede">
              Your taxonomy is a map Amarnai walks from the inbox down to a
              single folder. Drag the cards to arrange them, then connect
              folders by dragging from the blue handle dot — exactly as you
              would in the real product.
            </p>
          </div>
          <div className="ld-play-note">
            <span className="ld-play-dot" />
            Drag and connect. It&apos;s fully interactive.
          </div>
        </div>

        <div className="ld-app-frame ld-reveal">
          <div className="ld-frame-bar">
            <div className="ld-crumbs">
              <span>Acme Workspace</span>
              <span className="ld-sep">/</span>
              <span className="ld-here">Taxonomy</span>
            </div>
            <div className="ld-sync-chip">
              <span className="ld-sync-dot" />
              Synced
            </div>
          </div>
          <div className="ld-demo-stage">
            <DemoTaxonomyCanvas />
          </div>
        </div>
      </div>
    </section>
  );
}
