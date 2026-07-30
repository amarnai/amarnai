"use client";

import type { CSSProperties } from "react";
import { folderColorVars } from "@amarnai/core/emails";
import type { MockProvider } from "./types.js";

/**
 * One mirrored folder as the mail provider draws it: a Gmail label chip or an
 * Outlook category pill. The namespace is on screen rather than implied, so a
 * visitor can see whose label it is.
 *
 * The chip reads "Amarnai/<folder>": the namespace, held back, and the folder
 * itself. Intermediate ancestors are left out because a full path swamps an
 * inbox row; the whole stored name is still the chip's title.
 *
 * The swatch comes from the same resolver the workspace chips use, keyed on the
 * same folder id, so one folder is one color in the plan canvas, in the Amarnai
 * panel, and here inside the mailbox.
 */
export function ProviderLabelChip({
  folderId,
  segments,
  provider,
}: {
  folderId: string;
  /** Namespace-first path segments, e.g. ["Amarnai", "Customers", "Billing"]. */
  segments: string[];
  provider: MockProvider;
}) {
  const namespace = segments[0] ?? "";
  const leaf = segments[segments.length - 1] ?? "";

  return (
    <span
      className="ld-mb-label"
      data-provider={provider}
      style={folderColorVars({ id: folderId }) as CSSProperties}
      title={segments.join("/")}
    >
      {/* Outlook shows a category as a colored dot plus its name; Gmail tints
          the whole chip. One element, two provider-native renderings. */}
      {provider === "outlook" && <span className="ld-mb-label-dot" aria-hidden />}
      {segments.length > 1 && <span className="ld-mb-label-ns">{namespace}/</span>}
      <span className="ld-mb-label-leaf">{leaf}</span>
    </span>
  );
}
