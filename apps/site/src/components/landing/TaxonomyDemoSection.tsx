import { DemoTaxonomyCanvas } from "@/components/demo/DemoTaxonomyCanvas";

export function TaxonomyDemoSection() {
  return (
    <section className="ld-demo-section" id="taxonomy">
      <div className="ld-wrap">
        <div className="ld-demo-head ld-reveal">
          <div className="ld-copy">
            <h2 className="ld-section-h">Generate your plan.</h2>
            <p className="ld-section-lede">
              Your plan is a simple folder tree: your folders branching out from the inbox.
              Let Amarnai generate it from your inbox, start from a template, or draw it yourself.
              Then it walks the tree for every email that arrives.
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
