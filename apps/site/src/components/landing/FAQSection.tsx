"use client";

import { useState } from "react";

const FAQ_ITEMS = [
  {
    q: "Is Amarnai safe to connect to my Gmail?",
    a: "Amarnai connects with Gmail's read-only scope, so it can read your threads but cannot send, delete, label, or change anything in your account. It keeps only what it needs to sort and display threads: subjects, participants, snippets, and the labels and reasoning it generates. Full message bodies are fetched when needed and processed in memory, not stored, and OAuth tokens are encrypted at rest.",
  },
  {
    q: "How does Amarnai save me time?",
    a: "Instead of scanning a crowded inbox, you open Amarnai and find your threads already grouped into the folders you care about, so you can work through customer questions, investor updates, or hiring replies in focused batches. Each thread comes with a suggested folder and the reasoning behind it, and you can draft a reply or jump straight to the thread in Gmail with one click. Triage that used to take an hour takes minutes.",
  },
  {
    q: "How does Amarnai's taxonomy work?",
    a: "Building your taxonomy is straightforward: create a tree of folders (for example a Customers folder with Support and Billing beneath it) and describe each one in plain language. Amarnai walks the tree and routes every thread to the folder that fits best, based on your descriptions. Setup is just describing your folders in plain words, with no technical know-how required. To get started quickly, you can pick one of our ready-made templates, each a solid folder structure you can use as-is or adapt to your inbox.",
  },
  {
    q: "How is Amarnai different from Gmail's filters and labels?",
    a: "Gmail filters just slap a label on each message and leave it in the same crowded inbox. Amarnai reads every thread the way a person would and lays them out in a clean workspace where related threads sit together, each with the reasoning behind its placement, so you get a calmer view instead of one more buried label. Spam and promotions are kept out automatically unless you turn them on in settings, and anything Amarnai is unsure about is flagged for your review.",
  },
  {
    q: "Can Amarnai sort my existing inbox, not just new mail?",
    a: "Yes. Amarnai can work through the thousands of threads already sitting in your inbox, not only messages that arrive from now on. Historical triage and ongoing sorting use the same taxonomy, so your whole inbox ends up organized the same way.",
  },
  {
    q: "What happens to threads Amarnai is unsure about?",
    a: "Any thread the model is unsure about is flagged for review instead of being filed automatically. Open it to see the suggested folder, the confidence score, and the reasoning, then approve the routing or send it to a different folder.",
  },
  {
    q: "Can Amarnai draft replies?",
    a: "Yes. Open a thread, press Generate draft reply, and a suggested draft appears in Amarnai for you to read and edit. Nothing is ever sent for you: when you are happy with it, you can jump to the thread in Gmail with one click and paste your reply there to send. Each plan includes a monthly draft allowance.",
  },
  {
    q: "How is Amarnai's pricing structured?",
    a: "Pricing is per workspace, billed monthly or annually. Every account starts with a free Personal workspace, no card required. The paid Pro and Business plans add higher limits and include a 14-day trial. See the pricing page for current details.",
  },
  {
    q: "Can I self-host Amarnai?",
    a: "Yes. Amarnai is open source under the AGPL-3.0 license. You can clone the repository and run it yourself with Docker. Self-hosting is free and unsupported, with community support available on GitHub.",
  },
  {
    q: "What AI model does Amarnai use?",
    a: "Hosted plans run on a frontier large language model. Self-hosted deployments can point at any OpenAI-compatible provider, such as OpenAI or Google Gemini, or a local Ollama model for fully offline operation.",
  },
];

export function FAQSection() {
  const [openIndex, setOpenIndex] = useState<number | null>(null);

  function toggle(i: number) {
    setOpenIndex((prev) => (prev === i ? null : i));
  }

  return (
    <section className="ld-section" id="faq">
      <div className="ld-wrap">
        <div className="ld-section-head center ld-reveal">
          <h2 className="ld-section-h">FAQ</h2>
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
                {item.q}
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
                  <p className="ld-faq-a">{item.a}</p>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
