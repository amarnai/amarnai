export function HowItWorksSection() {
  return (
    <section className="ld-section" id="how">
      <div className="ld-wrap">
        <div className="ld-section-head ld-reveal">
          <h2 className="ld-section-h">Three steps. Then it sorts every email for you.</h2>
          <p className="ld-section-lede">
            Connect once, describe your world in plain language, and let Amarnai
            keep up — across new mail and the thousands of threads already
            sitting in your inbox.
          </p>
        </div>

        <div className="ld-steps">
          <div className="ld-step ld-reveal">
            <div className="ld-step-n">
              <span className="ld-step-num">1</span>
              Connect Gmail
            </div>
            <h3>Read-only, in seconds</h3>
            <p>
              Sign in with Google. Amarnai syncs your threads and labels — it
              never sends or deletes on your behalf.
            </p>
          </div>

          <div className="ld-step ld-reveal">
            <div className="ld-step-n">
              <span className="ld-step-num">2</span>
              Describe your folders
            </div>
            <h3>A tree in plain English</h3>
            <p>
              Lay out folders like <em>Customers</em>, <em>Investors</em>,{" "}
              <em>Hiring</em>. Write a sentence describing each — that&apos;s
              the whole config.
            </p>
          </div>

          <div className="ld-step ld-reveal">
            <div className="ld-step-n">
              <span className="ld-step-num">3</span>
              It sorts &amp; drafts
            </div>
            <h3>You stay in control</h3>
            <p>
              Threads land in the right folder with a confidence score and a
              reason. Low-confidence ones wait for you. Ask for a reply and
              Amarnai drafts one — never sent without you.
            </p>
          </div>
        </div>
      </div>
    </section>
  );
}
