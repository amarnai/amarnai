"use client";

import { useState, useCallback, useEffect, useRef, useMemo, type ReactNode } from "react";
import {
  ReactFlow,
  ReactFlowProvider,
  Background,
  Controls,
  useNodesState,
  useEdgesState,
  useReactFlow,
  type Edge,
  type Connection,
  type OnNodeDrag,
  type OnConnect,
  type EdgeMouseHandler,
  type NodeMouseHandler,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { Trans } from "@lingui/react/macro";
import { useLingui } from "@lingui/react";
import { msg } from "@lingui/core/macro";
import type {
  ApiClient,
  TaxonomyNode,
  TaxonomyEdge,
  UpdateTaxonomyEdgeInput,
  TaxonomyImportPreviewResult,
  TaxonomyMigrationMapping,
} from "@aziru/api-client";
import {
  TAXONOMY_TEMPLATES,
  matchesTemplate,
  localizeTemplate,
} from "@aziru/core/taxonomy";
import {
  TAXONOMY_MIN_NON_ROOT_NODES,
  MAX_TAXONOMY_NON_ROOT_NODES,
  countRoutableNonRootNodes,
  isTaxonomyRoutable,
  serializeTaxonomy,
  TaxonomyTransferFileSchema,
  validateTaxonomyTransfer,
  type TaxonomyTransferFile,
} from "@aziru/shared";
import { translateSource } from "@aziru/i18n";
import { Tooltip } from "../Tooltip.js";
import { useTheme } from "../theme/useTheme.js";
import {
  taxonomyNodeTypes as nodeTypes,
  taxonomyEdgeTypes as edgeTypes,
  toRFNodes,
  toRFEdges,
  TAXONOMY_MIN_ZOOM,
} from "../taxonomy/rfGraph.js";
import type { TaxonomyRFNode } from "../taxonomy/TaxonomyNodeCard.js";
import { MigrationReviewModal } from "./MigrationReviewModal.js";
import { NodeForm, type NodeFormSubmit } from "./NodeForm.js";
import { EdgeForm } from "./EdgeForm.js";
import { useTaxonomyHistory } from "./useTaxonomyHistory.js";
import { applySnapshotDiff } from "./applySnapshotDiff.js";
import "./taxonomy-editor.css";

type RFNode = TaxonomyRFNode;

// ─── Panel state ──────────────────────────────────────────────────────────────

type Panel =
  | { type: "none" }
  | { type: "create-node"; spawnPosition?: { x: number; y: number } }
  | { type: "edit-node"; node: TaxonomyNode }
  | { type: "edit-edge"; edge: TaxonomyEdge };

/** Which flow the host wants opened on mount, if any. */
export type TaxonomyEditorMode = "templates" | "generate";

export type TaxonomyEditorSlotHelpers = {
  /**
   * Apply a generated or imported taxonomy, running the migration review first
   * when the existing folders already hold threads.
   */
  applyFile: (file: TaxonomyTransferFile) => Promise<void>;
};

export type TaxonomyEditorProps = {
  api: ApiClient;
  workspaceId: string;
  initialNodes: TaxonomyNode[];
  initialEdges: TaxonomyEdge[];
  /** Renders the canvas without any mutation affordances. */
  readOnly?: boolean;
  /** Whether a mailbox is connected, which gates the generate-from-inbox paths. */
  mailConnected?: boolean;
  /** Open straight into one flow. The web app maps its ?openTemplates / ?openGenerate deep links onto this. */
  initialMode?: TaxonomyEditorMode;
  /** Fired once initialMode has been acted on, so the host can clear its URL. */
  onModeConsumed?: () => void;
  /**
   * Start the mailbox OAuth flow. Host-specific: the web app redirects to its
   * own connect route, the panel runs the extension's flow.
   */
  onConnectMail?: () => void;
  /** Open the host's generate-from-inbox flow (banner CTA). */
  onGenerate?: () => void;
  /**
   * The generate-from-inbox control, rendered in the toolbar. Supplied by the
   * host because the two surfaces present it very differently: the web app has a
   * full modal with an illustrated preview, the panel reuses its plan-setup
   * dialog rather than shipping a second copy of that UI.
   *
   * Given as a function so the host's control can hand an accepted proposal back
   * here to be applied. Applying is not a plain import: replacing a taxonomy that
   * already holds threads has to go through the migration review, which this
   * component owns.
   */
  generateSlot?: ReactNode | ((helpers: TaxonomyEditorSlotHelpers) => ReactNode);
  /**
   * Allow dragging between node handles to create a path. Off in the extension
   * panel, where handles are only a few pixels wide at fit-zoom; the folder
   * form's Parent picker is the reparenting affordance there.
   */
  nodesConnectable?: boolean;
  /** Show the file import/export buttons. Off on narrow surfaces. */
  showImportExport?: boolean;
  /** The taxonomy changed; the host reloads whatever it seeded from it. */
  onChanged?: () => void;
};

function TaxonomyEditorInner({
  api,
  workspaceId,
  initialNodes,
  initialEdges,
  readOnly = false,
  mailConnected = false,
  initialMode,
  onModeConsumed,
  onConnectMail,
  onGenerate,
  generateSlot,
  nodesConnectable = true,
  showImportExport = true,
  onChanged,
}: TaxonomyEditorProps) {
  const { _, i18n } = useLingui();

  const [dbNodes, setDbNodes] = useState<TaxonomyNode[]>(initialNodes);
  const [dbEdges, setDbEdges] = useState<TaxonomyEdge[]>(initialEdges);
  const [rfNodes, setRfNodes, onNodesChange] = useNodesState<RFNode>(
    toRFNodes(initialNodes, initialEdges),
  );
  const [rfEdges, setRfEdges, onEdgesChange] = useEdgesState<Edge>(
    toRFEdges(initialEdges, initialNodes),
  );
  const [panel, setPanel] = useState<Panel>({ type: "none" });
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [apiError, setApiError] = useState<string | null>(null);
  // Pending taxonomy replacement awaiting the migration-review step. Null when no
  // replace is in flight. `previewLoading` covers the preview round-trip.
  const [migration, setMigration] = useState<{
    file: TaxonomyTransferFile;
    preview: TaxonomyImportPreviewResult;
  } | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [templatePickerOpen, setTemplatePickerOpen] = useState(false);
  const [selectedTemplateIdx, setSelectedTemplateIdx] = useState<number | null>(
    null,
  );
  // Deterministic (no-LLM) best-fit template for the picker's "Recommended"
  // badge. Fetched lazily the first time the picker opens; the badge is progressive
  // enhancement, so any failure just leaves it unset.
  const [recommendedTemplateId, setRecommendedTemplateId] = useState<string | null>(
    null,
  );
  const recommendationFetchedRef = useRef(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const history = useTaxonomyHistory({
    nodes: initialNodes,
    edges: initialEdges,
  });
  const { screenToFlowPosition } = useReactFlow();
  const { resolved: resolvedTheme } = useTheme();

  // Edges bake in theme-resolved colors (ReactFlow markers can't read CSS vars
  // live), so rebuild them from the current data whenever the theme changes.
  useEffect(() => {
    setRfEdges(toRFEdges(dbEdges, dbNodes));
  }, [resolvedTheme, dbEdges, dbNodes, setRfEdges]);

  // Reset history when workspace changes (safety guard if component is reused).
  // Intentionally depends only on workspaceId — initialNodes/initialEdges are
  // the initial snapshot and must not trigger repeated resets on re-renders.
  useEffect(() => {
    history.reset({ nodes: initialNodes, edges: initialEdges });
  }, [workspaceId]);

  // Open the template picker or generate flow when the host asked for it (the
  // web app deep-links with ?openTemplates / ?openGenerate; the panel passes the
  // mode directly). Reported back once so the host can clear its URL.
  useEffect(() => {
    if (!initialMode) return;
    if (initialMode === "templates") {
      setSelectedTemplateIdx(null);
      setTemplatePickerOpen(true);
    }
    // Deep-linked generate with no inbox connected: send the user to the mail
    // OAuth flow rather than opening an empty generator that would wrongly
    // report "not enough variety".
    if (initialMode === "generate" && !mailConnected) {
      onConnectMail?.();
      return;
    }
    onModeConsumed?.();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Fetch the recommended template the first time the picker opens (only when an
  // inbox is connected — the endpoint returns nothing otherwise, and the server
  // gates on having enough inbox signal to make a reliable match).
  useEffect(() => {
    if (!templatePickerOpen || !mailConnected || recommendationFetchedRef.current) {
      return;
    }
    recommendationFetchedRef.current = true;
    let cancelled = false;
    api
      .taxonomyTemplateRecommendation(workspaceId)
      .then((r) => {
        if (!cancelled) setRecommendedTemplateId(r.recommendedTemplateId);
      })
      .catch(() => {
        // Badge is progressive enhancement; never block the picker on it.
      });
    return () => {
      cancelled = true;
    };
  }, [templatePickerOpen, mailConnected, workspaceId]);

  const onCanvasDoubleClick = useCallback(
    (event: React.MouseEvent<HTMLDivElement>) => {
      if (readOnly) return;
      const target = event.target as Element;
      if (!target.classList.contains("react-flow__pane")) return;
      const spawnPosition = screenToFlowPosition({
        x: event.clientX,
        y: event.clientY,
      });
      openPanel({ type: "create-node", spawnPosition });
    },
    [readOnly, screenToFlowPosition],
  );

  const refetch = useCallback(async () => {
    const [newNodes, newEdges] = await Promise.all([
      api.taxonomyNodes(workspaceId),
      api.taxonomyEdges(workspaceId),
    ]);
    setDbNodes(newNodes);
    setDbEdges(newEdges);
    setRfNodes(toRFNodes(newNodes, newEdges));
    setRfEdges(toRFEdges(newEdges, newNodes));
    onChanged?.();
    return { nodes: newNodes, edges: newEdges };
  }, [api, workspaceId, setRfNodes, setRfEdges, onChanged]);

  function openPanel(p: Panel) {
    setPanel(p);
    setFormError(null);
    setApiError(null);
  }

  // ─── Node drag stop: persist position ────────────────────────────────────

  const onNodeDragStop: OnNodeDrag<RFNode> = useCallback(
    async (_event, rfNode) => {
      if (readOnly) return;
      try {
        await api.updateTaxonomyNode(workspaceId, rfNode.id, {
          positionX: Math.round(rfNode.position.x),
          positionY: Math.round(rfNode.position.y),
        });
        const updatedNodes = dbNodes.map((n) =>
          n.id === rfNode.id
            ? {
                ...n,
                positionX: rfNode.position.x,
                positionY: rfNode.position.y,
              }
            : n,
        );
        setDbNodes(updatedNodes);
        history.push({ nodes: updatedNodes, edges: dbEdges });
      } catch (err) {
        setApiError(
          err instanceof Error ? err.message : _(msg`Failed to save position`),
        );
      }
    },
    [workspaceId, dbNodes, dbEdges, history, _],
  );

  // ─── Connect nodes: create edge ───────────────────────────────────────────

  const onConnect: OnConnect = useCallback(
    async (connection: Connection) => {
      if (readOnly) return;
      if (!connection.source || !connection.target) return;
      if (dbNodes.find((n) => n.id === connection.target && n.isRoot)) return;
      // The catch-all must stay a leaf (it is excluded from routing), so it
      // cannot be the source of a path. The server rejects this too.
      if (dbNodes.find((n) => n.id === connection.source && n.isCatchAll)) return;
      // The catch-all hangs directly off the inbox: only the root may connect
      // to it. The server rejects a non-root parent too.
      if (
        dbNodes.find((n) => n.id === connection.target && n.isCatchAll) &&
        !dbNodes.find((n) => n.id === connection.source && n.isRoot)
      )
        return;
      try {
        await api.createTaxonomyEdge(workspaceId, {
          sourceNodeId: connection.source,
          targetNodeId: connection.target,
        });
        const { nodes, edges } = await refetch();
        history.push({ nodes, edges });
      } catch (err) {
        setApiError(
          err instanceof Error ? err.message : _(msg`Failed to create path`),
        );
      }
    },
    [workspaceId, refetch, dbNodes, history, _],
  );

  // ─── Click node: open edit panel ──────────────────────────────────────────

  const onNodeClick: NodeMouseHandler<RFNode> = useCallback(
    (_event, rfNode) => {
      if (readOnly) return;
      const found = dbNodes.find((n) => n.id === rfNode.id);
      // The inbox root and the catch-all are fixed nodes and are not editable.
      if (found && !found.isRoot && !found.isCatchAll)
        openPanel({ type: "edit-node", node: found });
    },
    [dbNodes, readOnly],
  );

  // ─── Click edge: open edit panel ─────────────────────────────────────────

  const onEdgeClick: EdgeMouseHandler = useCallback(
    (_event, rfEdge) => {
      if (readOnly) return;
      const found = dbEdges.find((e) => e.id === rfEdge.id);
      if (!found) return;
      // The catch-all's incoming edge is fixed (it must stay reachable from the
      // inbox and is not re-parentable or deletable), so its Edit Path panel
      // never opens.
      if (dbNodes.find((n) => n.id === found.targetNodeId && n.isCatchAll))
        return;
      openPanel({ type: "edit-edge", edge: found });
    },
    [dbEdges, dbNodes, readOnly],
  );

  // ─── Node mutations ───────────────────────────────────────────────────────

  async function handleCreateNode(submit: NodeFormSubmit) {
    setSubmitting(true);
    setFormError(null);
    const spawnPosition =
      panel.type === "create-node" ? panel.spawnPosition : undefined;
    try {
      // Two calls (create folder, then its Path): if the Path call fails the
      // folder is left disconnected (shown as Ignored), matching mobile.
      const created = await api.createTaxonomyNode(workspaceId, {
        ...submit.data,
        ...(spawnPosition
          ? {
              positionX: Math.round(spawnPosition.x),
              positionY: Math.round(spawnPosition.y),
            }
          : {}),
      });
      if (submit.parentId) {
        await api.createTaxonomyEdge(workspaceId, {
          sourceNodeId: submit.parentId,
          targetNodeId: created.id,
        });
      }
      const { nodes, edges } = await refetch();
      history.push({ nodes, edges });
      setPanel({ type: "none" });
    } catch (err) {
      setFormError(
        err instanceof Error ? err.message : _(msg`Failed to create folder`),
      );
    } finally {
      setSubmitting(false);
    }
  }

  async function handleUpdateNode(nodeId: string, submit: NodeFormSubmit) {
    setSubmitting(true);
    setFormError(null);
    try {
      await api.updateTaxonomyNode(workspaceId, nodeId, submit.data);
      const pc = submit.parentChange;
      if (pc) {
        if (pc.currentEdgeId && pc.newParentId) {
          await api.updateTaxonomyEdge(workspaceId, pc.currentEdgeId, {
            newSourceNodeId: pc.newParentId,
          });
        } else if (pc.currentEdgeId && !pc.newParentId) {
          await api.deleteTaxonomyEdge(workspaceId, pc.currentEdgeId);
        } else if (!pc.currentEdgeId && pc.newParentId) {
          await api.createTaxonomyEdge(workspaceId, {
            sourceNodeId: pc.newParentId,
            targetNodeId: nodeId,
          });
        }
      }
      const { nodes, edges } = await refetch();
      history.push({ nodes, edges });
      setPanel({ type: "none" });
    } catch (err) {
      setFormError(
        err instanceof Error ? err.message : _(msg`Failed to update folder`),
      );
    } finally {
      setSubmitting(false);
    }
  }

  // ─── Edge mutations ───────────────────────────────────────────────────────

  async function handleUpdateEdge(
    edgeId: string,
    data: UpdateTaxonomyEdgeInput,
  ) {
    setSubmitting(true);
    setFormError(null);
    try {
      await api.updateTaxonomyEdge(workspaceId, edgeId, data);
      const { nodes, edges } = await refetch();
      history.push({ nodes, edges });
      setPanel({ type: "none" });
    } catch (err) {
      setFormError(
        err instanceof Error ? err.message : _(msg`Failed to update path`),
      );
    } finally {
      setSubmitting(false);
    }
  }

  async function handleDeleteNode(nodeId: string, moveToNodeId?: string) {
    setSubmitting(true);
    setFormError(null);
    try {
      await api.deleteTaxonomyNode(workspaceId, nodeId, moveToNodeId);
      const { nodes, edges } = await refetch();
      history.push({ nodes, edges });
      setPanel({ type: "none" });
    } catch (err) {
      setFormError(
        err instanceof Error ? err.message : _(msg`Failed to delete folder`),
      );
    } finally {
      setSubmitting(false);
    }
  }

  async function handleDeleteEdge(edgeId: string) {
    setSubmitting(true);
    setFormError(null);
    try {
      await api.deleteTaxonomyEdge(workspaceId, edgeId);
      const { nodes, edges } = await refetch();
      history.push({ nodes, edges });
      setPanel({ type: "none" });
    } catch (err) {
      setFormError(
        err instanceof Error ? err.message : _(msg`Failed to delete path`),
      );
    } finally {
      setSubmitting(false);
    }
  }

  // ─── Undo / Redo ──────────────────────────────────────────────────────────

  async function handleUndo() {
    if (!history.canUndo || !history.undoTarget) return;
    const from = history.present;
    const to = history.undoTarget;
    setPanel({ type: "none" });
    setSubmitting(true);
    setApiError(null);
    try {
      await applySnapshotDiff(api, from, to, workspaceId);
      history.undo();
      const { nodes, edges } = await refetch();
      history.sync({ nodes, edges });
    } catch (err) {
      setApiError(err instanceof Error ? err.message : _(msg`Failed to undo`));
    } finally {
      setSubmitting(false);
    }
  }

  async function handleRedo() {
    if (!history.canRedo || !history.redoTarget) return;
    const from = history.present;
    const to = history.redoTarget;
    setPanel({ type: "none" });
    setSubmitting(true);
    setApiError(null);
    try {
      await applySnapshotDiff(api, from, to, workspaceId);
      history.redo();
      const { nodes, edges } = await refetch();
      history.sync({ nodes, edges });
    } catch (err) {
      setApiError(err instanceof Error ? err.message : _(msg`Failed to redo`));
    } finally {
      setSubmitting(false);
    }
  }

  // ─── Export ───────────────────────────────────────────────────────────────

  function handleExport() {
    const file = serializeTaxonomy(dbNodes, dbEdges);
    const blob = new Blob([JSON.stringify(file, null, 2)], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const date = new Date().toISOString().slice(0, 10);
    const a = document.createElement("a");
    a.href = url;
    a.download = `aziru-taxonomy-${workspaceId}-${date}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }

  // ─── Import ───────────────────────────────────────────────────────────────

  function handleImportClick() {
    setApiError(null);
    fileInputRef.current?.click();
  }

  async function handleFileSelected(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    // Reset so the same file can be re-selected after an error
    e.target.value = "";
    if (!f) return;

    let raw: unknown;
    try {
      raw = JSON.parse(await f.text());
    } catch {
      setApiError(_(msg`Could not read file: invalid JSON.`));
      return;
    }

    const parsed = TaxonomyTransferFileSchema.safeParse(raw);
    if (!parsed.success) {
      const first = parsed.error.issues[0];
      const detail = first?.message ?? _(msg`unknown error`);
      setApiError(_(msg`Invalid taxonomy file: ${detail}`));
      return;
    }

    const validation = validateTaxonomyTransfer(parsed.data);
    if (!validation.ok) {
      setApiError(_(msg`Invalid taxonomy file: ${validation.error}`));
      return;
    }

    const currentlyRoutable = isTaxonomyRoutable(
      rfNodes.map((n) => ({ id: n.id, isRoot: n.data.node.isRoot, isCatchAll: n.data.node.isCatchAll ?? false })),
      rfEdges.map((e) => ({ sourceNodeId: e.source, targetNodeId: e.target })),
    );

    await beginImport(validation.data, currentlyRoutable);
  }

  // Entry point for every taxonomy replacement (file, template, generated). When
  // the current taxonomy can route (so threads may be sorted into folders that
  // are about to change), fetch the folder migration preview and open the review
  // modal. If nothing is affected, or the taxonomy cannot route yet, apply
  // directly with no mapping (re-sort everything, the legacy behavior).
  async function beginImport(file: TaxonomyTransferFile, currentlyRoutable: boolean) {
    if (submitting || previewLoading) return; // guard against double-submit
    if (!currentlyRoutable) {
      await executeImport(file);
      return;
    }
    setPreviewLoading(true);
    setApiError(null);
    try {
      const preview = await api.previewTaxonomyImport(workspaceId, file);
      const affected =
        preview.migrateCount + preview.resortCount > 0 ||
        preview.suggestions.some((s) => s.threadCount > 0);
      if (!affected) {
        await executeImport(file);
      } else {
        setMigration({ file, preview });
      }
    } catch (err) {
      setApiError(err instanceof Error ? err.message : _(msg`Could not prepare migration`));
    } finally {
      setPreviewLoading(false);
    }
  }

  async function executeImport(file: TaxonomyTransferFile, mapping?: TaxonomyMigrationMapping) {
    setMigration(null);
    setSubmitting(true);
    setApiError(null);
    try {
      await api.importTaxonomy(workspaceId, file, mapping);
      const { nodes, edges } = await refetch();
      history.reset({ nodes, edges });
    } catch (err) {
      setApiError(err instanceof Error ? err.message : _(msg`Import failed`));
    } finally {
      setSubmitting(false);
    }
  }

  // Templates are English data; localize names/descriptions (picker + every
  // folder) into the active locale once, then drive display, the "current"
  // match, and apply from this single array so persisted names match what the
  // user sees and what matchesTemplate compares against.
  const localizedTemplates = useMemo(
    () => TAXONOMY_TEMPLATES.map((t) => localizeTemplate(t, (s) => translateSource(i18n, s))),
    [i18n],
  );

  async function handleUseTemplate() {
    if (selectedTemplateIdx === null) return;
    const template = localizedTemplates[selectedTemplateIdx];
    if (!template) return;
    setTemplatePickerOpen(false);
    setSelectedTemplateIdx(null);
    await beginImport(template.file, taxonomyIsRoutable);
  }

  // ─── Render ───────────────────────────────────────────────────────────────

  const taxonomyIsRoutable = isTaxonomyRoutable(
    rfNodes.map((n) => ({ id: n.id, isRoot: n.data.node.isRoot, isCatchAll: n.data.node.isCatchAll ?? false })),
    rfEdges.map((e) => ({ sourceNodeId: e.source, targetNodeId: e.target })),
  );

  // Flat folder cap (mirrors server enforcement). Counts every non-root node.
  const atFolderCap =
    dbNodes.filter((n) => !n.isRoot).length >= MAX_TAXONOMY_NON_ROOT_NODES;

  const currentTemplateIdx = localizedTemplates.findIndex((t) =>
    matchesTemplate(dbNodes, dbEdges, t),
  );

  // Recommended template (ids survive localization). Suppress when it is already
  // the current template — the card is disabled and labeled "Current", so a
  // "Recommended" badge and reorder would just be noise. Selection stays
  // index-based into localizedTemplates, so we reorder a list of {template, idx}
  // pairs rather than the array itself.
  const recommendedIdx = recommendedTemplateId
    ? localizedTemplates.findIndex((t) => t.id === recommendedTemplateId)
    : -1;
  const showRecommended =
    recommendedIdx !== -1 && recommendedIdx !== currentTemplateIdx;
  const orderedTemplates = localizedTemplates.map((template, idx) => ({ template, idx }));
  if (showRecommended) {
    const rec = orderedTemplates.splice(recommendedIdx, 1)[0];
    if (rec) orderedTemplates.unshift(rec);
  }

  // The catch-all is not editable (its panel never opens), so the only
  // delete-disabled reason left here is having child folders.
  let nodeDeleteDisabledReason: string | null = null;
  if (panel.type === "edit-node") {
    const nodeHasOutgoingEdges = dbEdges.some(
      (e) => e.sourceNodeId === panel.node.id,
    );
    nodeDeleteDisabledReason = nodeHasOutgoingEdges
      ? _(msg`This folder has child folders. Remove their Paths first, then delete it.`)
      : null;
  }

  return (
    <div className="tx-root">
      {readOnly ? (
        <p className="tx-readonly">
          <Trans>Folders are view-only. Only workspace admins can edit them.</Trans>
        </p>
      ) : (
        <div className="tx-toolbar">
          {atFolderCap ? (
            <Tooltip
              content={_(
                msg`Folder limit reached (${MAX_TAXONOMY_NON_ROOT_NODES}). Delete a folder to add another.`
              )}
            >
              <span style={{ display: "inline-block", cursor: "not-allowed" }}>
                <button
                  className="tx-btn tx-btn--primary"
                  disabled
                  style={{ pointerEvents: "none" }}
                >
                  <Trans>+ Add Folder</Trans>
                </button>
              </span>
            </Tooltip>
          ) : (
            <button
              className="tx-btn tx-btn--primary"
              onClick={() => openPanel({ type: "create-node" })}
            >
              <Trans>+ Add Folder</Trans>
            </button>
          )}
          <Tooltip content={_(msg`Undo`)}>
            <button
              className="tx-btn tx-btn--ghost"
              onClick={handleUndo}
              disabled={!history.canUndo || submitting}
            >
              ↶
            </button>
          </Tooltip>
          <Tooltip content={_(msg`Redo`)}>
            <button
              className="tx-btn tx-btn--ghost"
              onClick={handleRedo}
              disabled={!history.canRedo || submitting}
            >
              ↷
            </button>
          </Tooltip>
          {/* A file round-trip is a poor fit for a 360px side panel, so the
              host can drop it; the web editor keeps it. */}
          {showImportExport && (
            <>
            <Tooltip
              content={
                taxonomyIsRoutable
                  ? _(msg`Export folders`)
                  : _(msg`Add at least 3 connected folders to export`)
              }
            >
              <button
                className="tx-btn tx-btn--ghost"
                onClick={handleExport}
                disabled={submitting || !taxonomyIsRoutable}
                aria-label={_(msg`Export folders`)}
              >
                <svg
                  width="14"
                  height="14"
                  viewBox="0 0 14 14"
                  fill="none"
                  aria-hidden
                >
                  <path
                    d="M7 11V3M4 6L7 3L10 6M2 13H12"
                    stroke="currentColor"
                    strokeWidth="1.5"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
                <Trans>Export</Trans>
              </button>
            </Tooltip>
            <Tooltip content={_(msg`Import folders (replaces current)`)}>
              <button
                className="tx-btn tx-btn--ghost"
                onClick={handleImportClick}
                disabled={submitting}
                aria-label={_(msg`Import folders`)}
              >
                <svg
                  width="14"
                  height="14"
                  viewBox="0 0 14 14"
                  fill="none"
                  aria-hidden
                >
                  <path
                    d="M7 3V11M4 8L7 11L10 8M2 13H12"
                    stroke="currentColor"
                    strokeWidth="1.5"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
                <Trans>Import</Trans>
              </button>
            </Tooltip>
            </>
          )}
          <Tooltip content={_(msg`Start from a template (replaces current)`)}>
            <button
              className="tx-btn tx-btn--ghost"
              onClick={() => {
                setSelectedTemplateIdx(null);
                setTemplatePickerOpen(true);
              }}
              disabled={submitting}
              aria-label={_(msg`Browse templates`)}
            >
              <svg
                width="14"
                height="14"
                viewBox="0 0 14 14"
                fill="none"
                aria-hidden
              >
                <path
                  d="M7 1.5L8.2 5.8L12.5 7L8.2 8.2L7 12.5L5.8 8.2L1.5 7L5.8 5.8Z"
                  stroke="currentColor"
                  strokeWidth="1.5"
                  strokeLinejoin="round"
                />
              </svg>
              <Trans>Templates</Trans>
            </button>
          </Tooltip>
          {typeof generateSlot === "function"
            ? generateSlot({
                applyFile: (file) => beginImport(file, taxonomyIsRoutable),
              })
            : generateSlot}
          <input
            ref={fileInputRef}
            type="file"
            accept="application/json,.json"
            style={{ display: "none" }}
            onChange={handleFileSelected}
          />
        </div>
      )}

      {apiError && (
        <p className="tx-error" role="alert">
          {apiError}
        </p>
      )}

      {(() => {
        // Count only folders actually reachable from the root — orphaned
        // nodes never receive threads, so they do not count toward the
        // routing threshold. Derived from live canvas state so the indicator
        // updates the moment an edge connects a node to the inbox.
        const routableCount = countRoutableNonRootNodes(
          rfNodes.map((n) => ({ id: n.id, isRoot: n.data.node.isRoot, isCatchAll: n.data.node.isCatchAll ?? false })),
          rfEdges.map((e) => ({
            sourceNodeId: e.source,
            targetNodeId: e.target,
          })),
        );
        if (routableCount >= TAXONOMY_MIN_NON_ROOT_NODES) return null;
        return (
          <div className="tx-banner">
            <span>
              <span className="tx-pill tx-pill--accent">
                {routableCount} / {TAXONOMY_MIN_NON_ROOT_NODES}
              </span>
              <Trans>
                {routableCount} of {TAXONOMY_MIN_NON_ROOT_NODES} folders
                connected to your inbox. Routing requires at least{" "}
                {TAXONOMY_MIN_NON_ROOT_NODES}.
              </Trans>
            </span>
            {!readOnly && (
              <button
                className="tx-btn tx-btn--primary"
                onClick={() => {
                  if (!mailConnected) {
                    onConnectMail?.();
                    return;
                  }
                  onGenerate?.();
                }}
              >
                <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden>
                  <path
                    d="M3 1.5L3.7 3.3L5.5 4L3.7 4.7L3 6.5L2.3 4.7L0.5 4L2.3 3.3ZM9.5 5L10.6 7.9L13.5 9L10.6 10.1L9.5 13L8.4 10.1L5.5 9L8.4 7.9Z"
                    stroke="currentColor"
                    strokeWidth="1.2"
                    strokeLinejoin="round"
                  />
                </svg>
                <Trans>Generate from inbox</Trans>
              </button>
            )}
          </div>
        );
      })()}

      <div className="tx-split">
        <div className="tx-canvas" onDoubleClick={onCanvasDoubleClick}>
          <ReactFlow
            nodes={rfNodes}
            edges={rfEdges}
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
            onNodeDragStop={onNodeDragStop}
            onConnect={onConnect}
            onNodeClick={onNodeClick}
            onEdgeClick={onEdgeClick}
            nodeTypes={nodeTypes}
            edgeTypes={edgeTypes}
            deleteKeyCode={null}
            zoomOnDoubleClick={false}
            nodesDraggable={!readOnly}
            nodesConnectable={!readOnly}
            fitView
            fitViewOptions={{ padding: 0.3 }}
            minZoom={TAXONOMY_MIN_ZOOM}
            proOptions={{ hideAttribution: true }}
          >
            <Background />
            <Controls />
          </ReactFlow>
        </div>

        {panel.type !== "none" && (
          <div className="tx-side">
            <button
              className="tx-panel-close"
              onClick={() => setPanel({ type: "none" })}
              aria-label={_(msg`Close panel`)}
            >
              ✕
            </button>
            {panel.type === "create-node" && (
              <NodeForm
                key="create-node"
                node={null}
                nodes={dbNodes}
                edges={dbEdges}
                onSubmit={handleCreateNode}
                onCancel={() => setPanel({ type: "none" })}
                submitting={submitting}
                error={formError}
              />
            )}
            {panel.type === "edit-node" && (
              <NodeForm
                key={panel.node.id}
                node={panel.node}
                nodes={dbNodes}
                edges={dbEdges}
                onSubmit={(submit) => handleUpdateNode(panel.node.id, submit)}
                onCancel={() => setPanel({ type: "none" })}
                onDelete={(moveToNodeId) =>
                  handleDeleteNode(panel.node.id, moveToNodeId)
                }
                deleteDisabledReason={nodeDeleteDisabledReason}
                classificationCount={panel.node.threadCount}
                otherNodes={dbNodes.filter(
                  (n) => n.id !== panel.node.id && !n.isRoot,
                )}
                submitting={submitting}
                error={formError}
              />
            )}
            {panel.type === "edit-edge" && (
              <EdgeForm
                key={panel.edge.id}
                edge={panel.edge}
                nodes={dbNodes}
                onSubmit={(data) => handleUpdateEdge(panel.edge.id, data)}
                onCancel={() => setPanel({ type: "none" })}
                onDelete={() => handleDeleteEdge(panel.edge.id)}
                submitting={submitting}
                error={formError}
              />
            )}
          </div>
        )}
      </div>

      {migration && (
        <MigrationReviewModal
          file={migration.file}
          preview={migration.preview}
          submitting={submitting}
          onCancel={() => setMigration(null)}
          onConfirm={(mapping) => executeImport(migration.file, mapping)}
        />
      )}

      {templatePickerOpen && (
        <div
          className="tx-modal-backdrop"
          onClick={(e) => {
            if (e.target === e.currentTarget) {
              setTemplatePickerOpen(false);
              setSelectedTemplateIdx(null);
            }
          }}
          onKeyDown={(e) => {
            if (e.key === "Escape") {
              setTemplatePickerOpen(false);
              setSelectedTemplateIdx(null);
            }
          }}
          role="dialog"
          aria-modal="true"
        >
          <div className="tx-modal">
            <div className="tx-modal-head">
              <h2 className="tx-modal-title">
                {taxonomyIsRoutable
                  ? <Trans>Replace with a template</Trans>
                  : <Trans>Start from a template</Trans>}
              </h2>
              <button
                className="tx-modal-close"
                aria-label={_(msg`Cancel`)}
                onClick={() => {
                  setTemplatePickerOpen(false);
                  setSelectedTemplateIdx(null);
                }}
              >
                ✕
              </button>
            </div>
            <div className="tx-modal-body">
              <div className="tx-option-cards">
                {orderedTemplates.map(({ template, idx }) => {
                  const rootRef = template.file.nodes.find(
                    (n) => n.isRoot,
                  )?.ref;
                  const topLevelNames = template.file.edges
                    .filter((e) => e.sourceRef === rootRef)
                    .map(
                      (e) =>
                        template.file.nodes.find((n) => n.ref === e.targetRef)
                          ?.name,
                    )
                    .filter((n): n is string => !!n);
                  const isSelected = selectedTemplateIdx === idx;
                  const isCurrent = currentTemplateIdx === idx;
                  const isRecommended = showRecommended && recommendedIdx === idx;
                  return (
                    <button
                      key={template.id}
                      type="button"
                      className={`tx-option-card${isSelected ? " tx-option-card--selected" : ""}`}
                      aria-pressed={isSelected}
                      disabled={isCurrent}
                      onClick={() => setSelectedTemplateIdx(idx)}
                    >
                      <span className="tx-option-card-radio">
                        {isSelected && (
                          <span className="tx-option-card-radio-dot" />
                        )}
                      </span>
                      <span className="tx-option-card-text">
                        <span className="tx-option-card-label">
                          {template.name}
                          {isCurrent && (
                            <span className="tx-pill"><Trans>Current</Trans></span>
                          )}
                          {isRecommended && (
                            <span className="tx-pill tx-pill--accent">
                              <Trans>Recommended for your inbox</Trans>
                            </span>
                          )}
                        </span>
                        <span className="tx-option-card-desc">
                          {template.description}
                        </span>
                        <span className="tx-chips">
                          {topLevelNames.map((name) => (
                            <span key={name} className="tx-pill">
                              {name}
                            </span>
                          ))}
                        </span>
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>
            <div className="tx-modal-foot">
              <button
                className="tx-btn tx-btn--ghost"
                onClick={() => {
                  setTemplatePickerOpen(false);
                  setSelectedTemplateIdx(null);
                }}
              >
                <Trans>Cancel</Trans>
              </button>
              <button
                className="tx-btn tx-btn--primary"
                onClick={handleUseTemplate}
                disabled={
                  selectedTemplateIdx === null ||
                  selectedTemplateIdx === currentTemplateIdx ||
                  submitting
                }
              >
                <Trans>Use template</Trans>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * The taxonomy editor: a ReactFlow canvas plus the forms that mutate it. Shared
 * so the web app and the extension panel render the same graph with the same
 * behaviour, differing only in the seams above.
 */
export function TaxonomyEditor(props: TaxonomyEditorProps) {
  return (
    <ReactFlowProvider>
      <TaxonomyEditorInner {...props} />
    </ReactFlowProvider>
  );
}
