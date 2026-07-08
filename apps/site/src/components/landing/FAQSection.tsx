"use client";

import { useState } from "react";
import { Trans } from "@lingui/react/macro";
import { useLingui } from "@lingui/react";
import { msg } from "@lingui/core/macro";
import type { MessageDescriptor } from "@lingui/core";

const FAQ_ITEMS: { q: MessageDescriptor; a: MessageDescriptor }[] = [
  {
    q: msg`Is connecting my inbox to Amarnai safe?`,
    a: msg`Yes. Amarnai connects with a read-only scope, so it can read your threads but cannot send, delete, label, or change anything in your account. It keeps only what it needs to sort and display threads: subjects, participants, snippets, and the labels and reasoning it generates. Full message bodies are fetched when needed and processed in memory, not stored, and OAuth tokens are encrypted at rest.`,
  },
  {
    q: msg`How do I know it's safe?`,
    a: msg`Five things keep your inbox safe. First, Amarnai is read-only by design: the permissions you grant through Google make it impossible for Amarnai to send, delete, or change any email. Second, Amarnai has passed Google's security review, completing the CASA security assessment required for any app that accesses Gmail. Third, you stay in control: replies stay drafts until you say so, nothing is ever sent on your behalf, and you can disconnect Amarnai at any time. Fourth, no email bodies are stored: Amarnai keeps labels and metadata, never the contents of your messages. Fifth, the code is public, so anyone can inspect exactly what touches your email.`,
  },
  {
    q: msg`How does Amarnai save me time?`,
    a: msg`Instead of scanning a crowded inbox, you open Amarnai and find your threads already grouped into the folders you care about, so you can work through customer questions, investor updates, or hiring replies in focused batches. Each thread comes with a suggested folder and the reasoning behind it, and you can draft a reply or jump straight to the thread in your inbox with one click. Sorting that used to take an hour takes minutes.`,
  },
  {
    q: msg`How does Amarnai's plan work?`,
    a: msg`Your plan is a tree of folders (for example a Customers folder with Support and Billing beneath it), each described in plain language, and Amarnai walks that tree to route every thread to the folder that fits best. The fastest way to build it is to let Amarnai generate one for you: it reads your inbox and proposes a complete tree, named and described, that you can keep as-is or adjust. You can also start from one of our ready-made templates or build your own from scratch. No technical know-how required.`,
  },
  {
    q: msg`Do I have to build the folder structure myself?`,
    a: msg`Not necessarily. Amarnai can generate a complete plan for you from your inbox, with one click. You can also start from a ready-made template. Most people generate a plan, rename two or three folders, and they're done.`,
  },
  {
    q: msg`How is Amarnai different from Gmail and Outlook filters?`,
    a: msg`Gmail and Outlook filters just slap a label or category on each message and leave it in the same crowded inbox. Amarnai reads every thread the way a person would and lays them out in a clean workspace where related threads sit together, each with the reasoning behind its placement, so you get a calmer view instead of one more buried label. Spam and promotions are kept out automatically unless you turn them on in settings, and anything Amarnai is unsure about is flagged for your review.`,
  },
  {
    q: msg`Does Amarnai work with Outlook?`,
    a: msg`Yes. Amarnai works with both Gmail and Outlook, each connected the same read-only way: Amarnai reads your threads to sort them and never sends, deletes, or changes anything in your account.`,
  },
  {
    q: msg`Can Amarnai sort my existing inbox, not just new mail?`,
    a: msg`Yes. Amarnai can work through the thousands of threads already sitting in your inbox, not only messages that arrive from now on. Clearing your backlog and sorting new mail use the same plan, so your whole inbox ends up organized the same way.`,
  },
  {
    q: msg`What happens to threads Amarnai is unsure about?`,
    a: msg`Any thread the model is unsure about is flagged for review instead of being filed automatically. Open it to see the suggested folder, the confidence score, and the reasoning, then approve the routing or send it to a different folder.`,
  },
  {
    q: msg`Can Amarnai draft replies?`,
    a: msg`Yes. Open a thread, press Generate draft reply, and a suggested draft appears in Amarnai for you to read and edit. Nothing is ever sent for you: when you are happy with it, you can jump to the thread in your inbox with one click and paste your reply there to send. Each subscription includes a monthly draft allowance.`,
  },
  {
    q: msg`How is Amarnai's pricing structured?`,
    a: msg`Pricing is per workspace, billed monthly or annually. Every account starts with a free Personal workspace, no card required. The paid Pro and Business subscriptions add higher limits and include a 14-day trial. See the pricing page for current details.`,
  },
  {
    q: msg`Can I self-host Amarnai?`,
    a: msg`Yes. Amarnai is open source under the AGPL-3.0 license. You can clone the repository and run it yourself with Docker. Self-hosting is free and unsupported, with community support available on GitHub.`,
  },
  {
    q: msg`Why is it called Amarnai?`,
    a: msg`Amarnai is named after the Amarna letters, a cache of clay tablets from around 1350 BC: the diplomatic correspondence between the pharaoh of Egypt and the kings and vassals of the ancient Near East. It is one of the earliest surviving inboxes, and almost all of it is incoming. Hundreds of letters reached the pharaoh, but barely any of his replies survive. Senders like Rib-Hadda of Byblos wrote again and again with little response, most likely because the pharaoh was too overloaded to keep up. Amarnai spares you from that fate.`,
  },
  {
    q: msg`What model does Amarnai use?`,
    a: msg`Hosted subscriptions run on a leading AI model. Self-hosted deployments can point at any OpenAI-compatible provider, such as OpenAI or Google Gemini, or a local Ollama model for fully offline operation.`,
  },
];

export function FAQSection() {
  const { _ } = useLingui();
  const [openIndex, setOpenIndex] = useState<number | null>(null);

  function toggle(i: number) {
    setOpenIndex((prev) => (prev === i ? null : i));
  }

  return (
    <section className="ld-section" id="faq">
      <div className="ld-wrap">
        <div className="ld-section-head center ld-reveal">
          <h2 className="ld-section-h"><Trans>FAQ</Trans></h2>
        </div>

        <div className="ld-faq">
          {FAQ_ITEMS.map((item, i) => (
            <div
              key={i}
              className={`ld-faq-item${openIndex === i ? " open" : ""}`}
            >
              <button
                type="button"
                className="ld-faq-q"
                onClick={() => toggle(i)}
                aria-expanded={openIndex === i}
              >
                {_(item.q)}
                <svg
                  className="ld-faq-chevron"
                  width="16"
                  height="16"
                  viewBox="0 0 16 16"
                  fill="none"
                  aria-hidden
                >
                  <path
                    d="M4 6l4 4 4-4"
                    stroke="currentColor"
                    strokeWidth="1.5"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
              </button>
              <div className="ld-faq-a-wrap">
                <div className="ld-faq-a-inner">
                  <p className="ld-faq-a">{_(item.a)}</p>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
