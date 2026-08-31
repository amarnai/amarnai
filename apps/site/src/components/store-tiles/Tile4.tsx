"use client";

import { Trans } from "@lingui/react/macro";
import { DemoTaxonomyCanvas, FolderIcon, SparkleIcon } from "@aziru/ui/demo";
import { TileFrame } from "./TileFrame";

/**
 * Store tile 4 — the folder tree from the landing page's taxonomy demo, with
 * two staged cards floating over the canvas naming the two ways to get one:
 * pick a template (real template names from packages/core) or generate from
 * the inbox. The frame bar's own generate button is hidden on this tile (CSS)
 * so the story is told once. No browser chrome: the editor is Aziru's own
 * surface, not a mail page.
 */
export function Tile4() {
  return (
    <TileFrame
      headline={
        <Trans>
          <span className="soft">Your folders,</span> your way.
        </Trans>
      }
      className="st-tile-folders"
    >
      {/* Our own frame bar: the canvas's bar (hidden on this tile) carries only
          the generate button; the tile shows both ways side by side. */}
      <div className="ld-frame-bar st-bar">
        <div className="ld-crumbs">
          <span>
            <Trans>Workspace</Trans>
          </span>
          <span className="ld-sep">/</span>
          <span className="ld-here">
            <Trans>Folders</Trans>
          </span>
        </div>
        <div className="st-bar-actions">
          <span className="st-bar-btn">
            <Trans>Start from a template</Trans>
          </span>
          <span className="demo-generate-btn">
            <SparkleIcon />
            <Trans>Generate from inbox</Trans>
          </span>
        </div>
      </div>

      <DemoTaxonomyCanvas />

      <div className="st-card-stack">
      <div className="st-float-card st-gen-card">
        <div className="st-card-head">
          <SparkleIcon />
          <Trans>Generate from inbox</Trans>
        </div>
        <ol>
          <li>
            <Trans>Click once</Trans>
          </li>
          <li>
            <Trans>Review the proposed folders</Trans>
          </li>
          <li>
            <Trans>Apply</Trans>
          </li>
        </ol>
      </div>

      <div className="st-float-card st-tpl-card">
        <div className="st-card-head">
          <Trans>Start from a template</Trans>
        </div>
        <ul>
          <li>
            <FolderIcon />
            <Trans>Freelancer</Trans>
          </li>
          <li className="is-active">
            <FolderIcon />
            <Trans>Startup Founder</Trans>
          </li>
          <li>
            <FolderIcon />
            <Trans>Software Developer</Trans>
          </li>
          <li>
            <FolderIcon />
            <Trans>Content Creator</Trans>
          </li>
        </ul>
        <div className="st-card-foot">
          <Trans>…and 8 more</Trans>
        </div>
      </div>
      </div>

    </TileFrame>
  );
}
