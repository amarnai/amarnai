import { Trans } from "@lingui/react/macro";
import { DemoTaxonomyCanvas } from "@amarnai/ui/demo";

export function TaxonomyDemoSection() {
  return (
    <section className="ld-demo-section" id="taxonomy">
      <div className="ld-wrap">
        <div className="ld-demo-head ld-reveal">
          <div className="ld-copy">
            <h2 className="ld-section-h"><Trans>Generate your folders.</Trans></h2>
            <p className="ld-section-lede">
              <Trans>
                Your folders form a simple tree, branching out from the inbox.
                Let Amarnai generate them from your inbox, start from a
                template, or draw them yourself. Then it walks the tree for
                every email that arrives.
              </Trans>
            </p>
          </div>
        </div>

        <div className="ld-app-frame ld-reveal">
          <DemoTaxonomyCanvas />
        </div>
      </div>
    </section>
  );
}
