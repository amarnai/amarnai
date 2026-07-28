"use client";

import { useState } from "react";
import { Trans, Plural } from "@lingui/react/macro";
import { useLingui } from "@lingui/react";
import { msg } from "@lingui/core/macro";
import type { TaxonomyNode, TaxonomyEdge, CreateTaxonomyNodeInput } from "@amarnai/api-client";
import { descendantIds } from "@amarnai/core/taxonomy";
import { FOLDER_COLOR_KEYS } from "@amarnai/core/emails";
import { minNodeNameLength, minNodeDescriptionLength } from "@amarnai/shared";
import { Tooltip } from "../Tooltip.js";
import { DescriptionTips } from "./DescriptionTips.js";
import "./taxonomy-editor.css";

export type ParentChange = {
  currentEdgeId: string | null;
  newParentId: string | null;
};

export type NodeFormSubmit = {
  data: CreateTaxonomyNodeInput;
  /** create mode: chosen parent (null = orphan / no edge) */
  parentId: string | null;
  /** edit mode: present only when the parent actually changed */
  parentChange?: ParentChange;
};

export type NodeFormProps = {
  node: TaxonomyNode | null;
  nodes: TaxonomyNode[];
  edges: TaxonomyEdge[];
  onSubmit: (submit: NodeFormSubmit) => void;
  onCancel: () => void;
  onDelete?: (moveToNodeId?: string) => void;
  deleteDisabledReason?: string | null;
  classificationCount?: number;
  otherNodes?: Pick<TaxonomyNode, "id" | "name">[];
  submitting: boolean;
  error: string | null;
};

export function NodeForm({
  node,
  nodes,
  edges,
  onSubmit,
  onCancel,
  onDelete,
  deleteDisabledReason,
  classificationCount = 0,
  otherNodes = [],
  submitting,
  error,
}: NodeFormProps) {
  const { _ } = useLingui();
  const isRoot = node?.isRoot ?? false;

  // A folder's parent is modelled as a single "Parent" choice instead of a
  // standalone Path: the form reuses / creates / deletes the incoming edge as
  // needed. This is also the only reparenting affordance on a narrow surface,
  // where dragging a connection between handles is not realistic.
  const currentEdge = node ? (edges.find((e) => e.targetNodeId === node.id) ?? null) : null;
  const currentParentId = currentEdge?.sourceNodeId ?? null;

  // Parent options exclude the folder itself and its descendants (cycle guard;
  // the server would reject re-parenting a folder under its own subtree), and
  // the catch-all, which must stay a leaf (it is excluded from routing).
  const excluded = node
    ? new Set<string>([node.id, ...descendantIds(edges, node.id)])
    : new Set<string>();
  const parentOptions = nodes.filter((n) => !excluded.has(n.id) && !n.isCatchAll);

  const [name, setName] = useState(node?.name ?? "");
  const nameValid = name.trim().length >= minNodeNameLength(name) && name.trim().length <= 40;
  const [description, setDescription] = useState(node?.description ?? "");
  const descriptionValid =
    isRoot || description.replace(/\s/g, "").length >= minNodeDescriptionLength(description);
  const [draftPrompt, setDraftPrompt] = useState(node?.draftPrompt ?? "");
  // null = no override (deterministic hash default). A palette key otherwise.
  const [colorKey, setColorKey] = useState<string | null>(node?.colorKey ?? null);
  // "" represents "None (not connected)".
  const [parentId, setParentId] = useState(currentParentId ?? "");
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [moveToNodeId, setMoveToNodeId] = useState("");

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const trimmedDescription = description.trim();
    const trimmedDraftPrompt = draftPrompt.trim();
    const data: CreateTaxonomyNodeInput = {
      name: name.trim(),
      // Only include description if non-empty; omitting it on a root-node edit
      // leaves the existing DB value unchanged.
      ...(trimmedDescription ? { description: trimmedDescription } : {}),
      instructions: node?.instructions ?? null,
      draftPrompt: trimmedDraftPrompt || null,
      examples: node?.examples ?? [],
      colorKey,
    };
    const chosenParentId = parentId === "" ? null : parentId;
    if (node && !isRoot && chosenParentId !== currentParentId) {
      onSubmit({
        data,
        parentId: chosenParentId,
        parentChange: {
          currentEdgeId: currentEdge?.id ?? null,
          newParentId: chosenParentId,
        },
      });
    } else {
      onSubmit({ data, parentId: chosenParentId });
    }
  }

  function handleDeleteClick() {
    if (classificationCount > 0) {
      setConfirmingDelete(true);
    } else {
      onDelete?.();
    }
  }

  // Why the Create/Save button is disabled, for a hover/focus tooltip. Only the
  // validation cases get a reason; `submitting` is transient and already shown as
  // the button label ("Saving…"), so it needs no explanation.
  const submitDisabledReason = !nameValid
    ? _(msg`Enter a folder name (at least ${minNodeNameLength(name)} characters).`)
    : !descriptionValid
      ? _(
          msg`Add a description (at least ${minNodeDescriptionLength(description)} characters) so the AI can sort accurately.`
        )
      : null;

  // Shared between the plain and tooltip-wrapped branches so the markup lives in
  // one place. When a validation reason applies, pointerEvents:none lets hover
  // reach the wrapping span so the Tooltip can show.
  const submitButton = (
    <button
      className="tx-btn tx-btn--primary"
      type="submit"
      disabled={submitting || !nameValid || !descriptionValid}
      style={submitDisabledReason != null ? { pointerEvents: "none" } : undefined}
    >
      {submitting ? <Trans>Saving…</Trans> : node ? <Trans>Save</Trans> : <Trans>Create</Trans>}
    </button>
  );

  return (
    <div>
      <h2 className="tx-modal-title">
        {node ? <Trans>Edit Folder</Trans> : <Trans>Create Folder</Trans>}
      </h2>
      {error && (
        <p className="tx-error" role="alert">
          {error}
        </p>
      )}
      <form className="tx-form" onSubmit={handleSubmit}>
        <div className="tx-field">
          <label className="tx-label" htmlFor="tx-node-name">
            <Trans>Name</Trans> <span className="tx-required">*</span>
          </label>
          <input
            id="tx-node-name"
            className="tx-input"
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
            minLength={3}
            maxLength={40}
          />
        </div>

        <div className="tx-field">
          <label className="tx-label" htmlFor="tx-node-description">
            <Trans>Description</Trans>
            {!isRoot && <span className="tx-required"> *</span>}
          </label>
          <textarea
            id="tx-node-description"
            className="tx-textarea"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            required={!isRoot}
            maxLength={300}
            placeholder={_(
              msg`e.g. Invoices, receipts, payment confirmations, and billing questions from clients and vendors.`
            )}
          />
          {!isRoot && (
            <>
              <p className="tx-hint">
                <Trans>
                  List the kinds of emails that belong here: senders, topics, keywords. Aim for a
                  full sentence.
                </Trans>
              </p>
              <DescriptionTips />
            </>
          )}
        </div>

        {!isRoot && (
          <div className="tx-field">
            <span className="tx-label">
              <Trans>Color</Trans>
            </span>
            <div className="tx-swatches" role="radiogroup" aria-label={_(msg`Folder color`)}>
              {/* Default = no override; the folder falls back to its stable
                  hash-assigned swatch. */}
              <button
                type="button"
                role="radio"
                aria-checked={colorKey === null}
                aria-label={_(msg`Default color`)}
                title={_(msg`Default`)}
                className={`tx-swatch tx-swatch--auto${colorKey === null ? " is-selected" : ""}`}
                onClick={() => setColorKey(null)}
              >
                <Trans>Auto</Trans>
              </button>
              {FOLDER_COLOR_KEYS.map((key) => (
                <button
                  key={key}
                  type="button"
                  role="radio"
                  aria-checked={colorKey === key}
                  aria-label={key}
                  title={key}
                  className={`tx-swatch${colorKey === key ? " is-selected" : ""}`}
                  style={{
                    background: `var(--folder-${key}-ink)`,
                    borderColor: colorKey === key ? undefined : `var(--folder-${key}-line)`,
                  }}
                  onClick={() => setColorKey(key)}
                />
              ))}
            </div>
            <p className="tx-hint">
              <Trans>
                Optional. Sets this folder&rsquo;s chip and icon color across your inbox. Default
                assigns a stable color automatically.
              </Trans>
            </p>
          </div>
        )}

        <div className="tx-field">
          <label className="tx-label" htmlFor="tx-node-draft">
            <Trans>Draft style guidance</Trans>
          </label>
          <textarea
            id="tx-node-draft"
            className="tx-textarea"
            value={draftPrompt}
            onChange={(e) => setDraftPrompt(e.target.value)}
            maxLength={500}
            placeholder={_(msg`e.g. Reply formally. Keep responses under 3 sentences.`)}
          />
          <p className="tx-hint">
            <Trans>
              Optional. Applied when generating draft replies for threads in this folder.
            </Trans>
          </p>
        </div>

        {!isRoot && (
          <div className="tx-field">
            <label className="tx-label" htmlFor="tx-node-parent">
              <Trans>Parent</Trans>
            </label>
            <select
              id="tx-node-parent"
              className="tx-select"
              value={parentId}
              onChange={(e) => setParentId(e.target.value)}
            >
              <option value="">{_(msg`None (not connected)`)}</option>
              {parentOptions.map((n) => (
                <option key={n.id} value={n.id}>
                  {n.isRoot ? _(msg`Inbox`) : n.name}
                </option>
              ))}
            </select>
            <p className="tx-hint">
              <Trans>
                Where this folder sits. Folders with no parent stay disconnected and are ignored
                until connected.
              </Trans>
            </p>
          </div>
        )}

        {confirmingDelete ? (
          <>
            <p className="tx-warning">
              <Plural
                value={classificationCount}
                one="Deleting this folder will leave # thread unsorted."
                other="Deleting this folder will leave # threads unsorted."
              />
            </p>
            {otherNodes.length > 0 && (
              <div className="tx-field">
                <label className="tx-label" htmlFor="tx-move-to">
                  <Trans>Move them to</Trans>
                </label>
                <select
                  id="tx-move-to"
                  className="tx-select"
                  value={moveToNodeId}
                  onChange={(e) => setMoveToNodeId(e.target.value)}
                >
                  <option value="">{_(msg`Leave unsorted`)}</option>
                  {otherNodes.map((n) => (
                    <option key={n.id} value={n.id}>
                      {n.name}
                    </option>
                  ))}
                </select>
              </div>
            )}
            <div className="tx-actions">
              <button
                className="tx-btn tx-btn--danger"
                type="button"
                onClick={() => onDelete?.(moveToNodeId || undefined)}
                disabled={submitting}
              >
                {submitting ? <Trans>Deleting…</Trans> : <Trans>Confirm Delete</Trans>}
              </button>
              <button
                className="tx-btn tx-btn--ghost"
                type="button"
                onClick={() => setConfirmingDelete(false)}
                disabled={submitting}
              >
                <Trans>Cancel</Trans>
              </button>
            </div>
          </>
        ) : (
          <div className="tx-actions">
            {submitDisabledReason != null ? (
              <Tooltip content={submitDisabledReason}>
                <span style={{ display: "inline-block", cursor: "not-allowed" }}>
                  {submitButton}
                </span>
              </Tooltip>
            ) : (
              submitButton
            )}
            <button className="tx-btn tx-btn--ghost" type="button" onClick={onCancel}>
              <Trans>Cancel</Trans>
            </button>
            {node &&
              !node.isRoot &&
              onDelete &&
              (deleteDisabledReason != null ? (
                <Tooltip content={deleteDisabledReason ?? ""}>
                  <span style={{ display: "inline-block", cursor: "not-allowed" }}>
                    <button
                      className="tx-btn tx-btn--danger"
                      type="button"
                      disabled
                      style={{ pointerEvents: "none" }}
                    >
                      <Trans>Delete</Trans>
                    </button>
                  </span>
                </Tooltip>
              ) : (
                <button
                  className="tx-btn tx-btn--danger"
                  type="button"
                  onClick={handleDeleteClick}
                  disabled={submitting}
                >
                  <Trans>Delete</Trans>
                </button>
              ))}
          </div>
        )}
      </form>
    </div>
  );
}
