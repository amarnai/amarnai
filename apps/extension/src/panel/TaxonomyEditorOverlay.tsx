import { useEffect, useState } from "react";
import { Trans } from "@lingui/react/macro";
import { useLingui } from "@lingui/react";
import { msg } from "@lingui/core/macro";
import type { ApiClient, TaxonomyNode, TaxonomyEdge } from "@amarnai/api-client";
import { TaxonomyEditor } from "@amarnai/ui/taxonomy-editor";
import type { PlanSetupMode } from "@amarnai/ui/plan-setup";

type Props = {
  api: ApiClient;
  workspaceId: string;
  /** Whether a mailbox is connected, which gates the generate-from-inbox paths. */
  mailConnected: boolean;
  /** Open the panel's plan-setup dialog, which owns generate-from-inbox here. */
  onOpenPlanSetup: (mode: PlanSetupMode) => void;
  /** The taxonomy changed; the panel reseeds its folder list. */
  onChanged: () => void;
  onClose: () => void;
};

/**
 * Full-panel taxonomy editor. The canvas is the same one the web app and the
 * plan-setup preview render, which is the point: it is the product's most
 * recognisable surface and dropping to a plain list here would read as a
 * downgrade from the approval screen users have already seen.
 *
 * Two affordances are deliberately off at this width. Dragging between node
 * handles is unusable when the whole tree is zoomed to fit, so reparenting goes
 * through the folder form's Parent picker; and file import/export is a poor fit
 * for a side panel. Both remain available in the web editor.
 */
export function TaxonomyEditorOverlay({
  api,
  workspaceId,
  mailConnected,
  onOpenPlanSetup,
  onChanged,
  onClose,
}: Props) {
  const { _ } = useLingui();
  const [graph, setGraph] = useState<{ nodes: TaxonomyNode[]; edges: TaxonomyEdge[] } | null>(
    null
  );
  const [failed, setFailed] = useState(false);

  // Loaded on open rather than handed down from the panel's seed: the panel can
  // have been sitting open for a long time, and editing a stale graph would
  // write against folders that may already have moved.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [nodes, edges] = await Promise.all([
          api.taxonomyNodes(workspaceId),
          api.taxonomyEdges(workspaceId),
        ]);
        if (!cancelled) setGraph({ nodes, edges });
      } catch {
        if (!cancelled) setFailed(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [api, workspaceId]);

  return (
    <div className="ps-overlay">
      <div className="ax-editor">
        <div className="ax-editor-head">
          <button type="button" className="ax-back" onClick={onClose} aria-label={_(msg`Back`)}>
            <svg width="16" height="16" viewBox="0 0 14 14" fill="none" aria-hidden>
              <path
                d="M9 11L5 7l4-4"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </button>
          <h2 className="ax-editor-title">
            <Trans>Folders</Trans>
          </h2>
        </div>

        <div className="ax-editor-body">
          {failed && (
            <p className="tx-error" role="alert">
              <Trans>Could not load your folders. Please try again.</Trans>
            </p>
          )}
          {!graph && !failed && (
            <div className="ax-center">
              <span className="ax-spinner" aria-label={_(msg`Loading`)} />
            </div>
          )}
          {graph && (
            <TaxonomyEditor
              api={api}
              workspaceId={workspaceId}
              initialNodes={graph.nodes}
              initialEdges={graph.edges}
              mailConnected={mailConnected}
              nodesConnectable={false}
              showImportExport={false}
              onConnectMail={() => onOpenPlanSetup("generate")}
              onGenerate={() => onOpenPlanSetup("generate")}
              onChanged={onChanged}
            />
          )}
        </div>
      </div>
    </div>
  );
}
