"use client";

import { useState } from "react";
import Link from "next/link";
import { HERO_TREE_ITEMS } from "@/components/demo/demo-seed";

type TreeLeaf = { id: string; label: string; count: number };

function FolderIcon({ size = 12 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 12 12" fill="none" aria-hidden>
      <path d="M1.2 3.2h2.4l.8-.9h4.4v5.6H1.2V3.2z" stroke="currentColor" strokeWidth="1.1" strokeLinejoin="round" />
    </svg>
  );
}

function HeroTaxonomyCard() {
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const activeId = hoveredId ?? "customers-enterprise";

  return (
    <div className="ld-hero-card" onMouseLeave={() => setHoveredId(null)}>
      <div className="ld-hero-card-cap">
        <span className="ld-hero-card-title">Your taxonomy</span>
        <span className="ld-live-chip">
          <span className="ld-pulse" />
          Sorting live
        </span>
      </div>
      <div className="ld-hero-tree">
        <div className="ld-tree-root">
          <span className="ld-tree-root-icon">
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden>
              <path d="M2 4.2L7 2l5 2.2v3.6c0 2.8-2 4.5-5 5.8-3-1.3-5-3-5-5.8V4.2z" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round" />
            </svg>
          </span>
          <span>Inbox</span>
          <span className="ld-tree-root-count">412 threads</span>
        </div>

        <div className="ld-tree-children">
          {HERO_TREE_ITEMS.map((item) => {
            if ("children" in item) {
              return (
                <div key={item.id} className="ld-tree-group">
                  <div
                    className={`ld-tree-child ld-tree-child--parent${item.id === activeId ? " ld-tree-child--active" : ""}`}
                    onMouseEnter={() => setHoveredId(item.id)}
                  >
                    <span className="ld-tree-child-icon"><FolderIcon /></span>
                    <span className="ld-tree-child-label">{item.label}</span>
                  </div>
                  <div className="ld-tree-subchildren">
                    {item.children.map((child) => (
                      <div
                        key={child.id}
                        className={`ld-tree-child ld-tree-child--sub${child.id === activeId ? " ld-tree-child--active" : ""}`}
                        onMouseEnter={() => setHoveredId(child.id)}
                      >
                        <span className="ld-tree-child-icon"><FolderIcon size={10} /></span>
                        <span className="ld-tree-child-label">{child.label}</span>
                        <span className="ld-tree-child-count">{child.count}</span>
                      </div>
                    ))}
                  </div>
                </div>
              );
            }
            return (
              <div
                key={item.id}
                className={`ld-tree-child${item.id === activeId ? " ld-tree-child--active" : ""}`}
                onMouseEnter={() => setHoveredId(item.id)}
              >
                <span className="ld-tree-child-icon"><FolderIcon /></span>
                <span className="ld-tree-child-label">{item.label}</span>
                <span className="ld-tree-child-count">{(item as TreeLeaf).count}</span>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

export function HeroSection() {
  return (
    <section className="ld-hero" id="hero">
      <div className="ld-wrap">
        <div className="ld-hero-grid">
          <div className="ld-hero-main">
            <div className="ld-hero-badge">
              <span className="ld-tag">Beta · available now</span>
              Hosted · Gmail-first AI triage
            </div>

            <h1>
              Stop sorting email.<br />
              <span className="soft">Sort it once.</span>
            </h1>

            <p className="ld-hero-sub">
              Draw the map of where your mail should go, describe each folder in
              a sentence, and let Amarnai keep your inbox in order — across new
              mail and the thousands of threads already piled up.
            </p>

            <div className="ld-cta-row">
              <Link className="ld-btn accent lg" href="/pricing">
                Start free
              </Link>
            </div>
            <p className="ld-cta-note">Priced per user · 14-day free trial</p>
          </div>

          <div className="ld-hero-side">
            <HeroTaxonomyCard />
          </div>
        </div>

        <div className="ld-trust">
          <span className="ld-trust-label">Built to be trusted</span>
          <div className="ld-trust-items">
            <span className="ld-trust-item">
              <svg width="15" height="15" viewBox="0 0 15 15" fill="none" aria-hidden>
                <path d="M7.5 1.3 2 3.4v3.7c0 3.2 2.3 5.3 5.5 6.6 3.2-1.3 5.5-3.4 5.5-6.6V3.4L7.5 1.3Z" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round" />
              </svg>
              Never auto-sends email
            </span>
            <span className="ld-trust-item">
              <svg width="15" height="15" viewBox="0 0 15 15" fill="none" aria-hidden>
                <rect x="3" y="6.5" width="9" height="6.5" rx="1.3" stroke="currentColor" strokeWidth="1.2" />
                <path d="M4.8 6.5V5a2.7 2.7 0 0 1 5.4 0v1.5" stroke="currentColor" strokeWidth="1.2" />
              </svg>
              Tokens encrypted at rest
            </span>
            <span className="ld-trust-item">
              <svg width="15" height="15" viewBox="0 0 15 15" fill="none" aria-hidden>
                <path d="M2 7.5h11M7.5 2v11" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
                <circle cx="7.5" cy="7.5" r="5.7" stroke="currentColor" strokeWidth="1.2" />
              </svg>
              Open-source &amp; self-hostable
            </span>
            <span className="ld-trust-item">
              <svg width="15" height="15" viewBox="0 0 15 15" fill="none" aria-hidden>
                <path d="M7.5 1.5 13 4v3.5c0 .8-.1 1.5-.3 2.2" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
                <path d="M7.5 13.5C4.3 12.2 2 10.2 2 7V4l5.5-2.5" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round" />
              </svg>
              Stores minimal email data
            </span>
          </div>
        </div>
      </div>
    </section>
  );
}
