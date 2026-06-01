"use client";

import { useState } from "react";

const FAQ_ITEMS = [
  {
    q: "What does Amarnai actually do to my Gmail?",
    a: "Amarnai reads your threads using Gmail's read-only OAuth scope. It never sends email, never modifies labels directly, and never deletes anything. All writes — if any — require your explicit approval.",
  },
  {
    q: "How does the taxonomy work?",
    a: "You define a tree of folders (like Customers → Enterprise, Customers → SMB) and describe each in a sentence. Amarnai walks that tree and routes each thread to the best match. The model sees your descriptions, not your rules — you write plain English, not code.",
  },
  {
    q: "What happens to low-confidence threads?",
    a: "Any thread below your confidence threshold lands in the review queue and waits for you. You see the reason and the top alternative. One click to approve, re-route, or ignore.",
  },
  {
    q: "Can Amarnai draft replies?",
    a: "Yes — open a thread and press Generate draft reply. A draft appears in the interface for your review. It is never sent automatically and never leaves Amarnai until you copy it into Gmail yourself.",
  },
  {
    q: "How is pricing structured?",
    a: "Pricing is per user, billed monthly or annually. Every account starts with a 14-day free trial — no card required. See the pricing page for current plan details.",
  },
  {
    q: "Can I self-host Amarnai?",
    a: "Yes. Amarnai is fully open source under AGPL-3.0. You can clone the repo and run it yourself with Docker. Self-hosted deployments are free and unsupported — community support is available on GitHub.",
  },
  {
    q: "What AI model does Amarnai use?",
    a: "Hosted plans use frontier models (currently Claude). Self-hosted deployments can be configured to use any provider, including local Ollama for fully offline operation.",
  },
  {
    q: "Does Amarnai store my email content?",
    a: "Amarnai stores the minimum needed to sort and display threads: subject, participants, snippet, and AI-generated metadata. Full email bodies are processed in memory and not persisted. OAuth tokens are encrypted at rest.",
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
            <div key={i} className={`ld-faq-item${openIndex === i ? " open" : ""}`}>
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
              <p className="ld-faq-a">{item.a}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
