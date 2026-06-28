import { useEffect, useMemo, useState } from 'react';
import {
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useLingui } from '@lingui/react';
import { msg } from '@lingui/core/macro';
import { Trans, Plural } from '@lingui/react/macro';
import { colors, radii, space, fontSize, fontWeight } from '@amarnai/tokens';
import type {
  CreateTaxonomyNodeInput,
  TaxonomyEdge,
  TaxonomyNode,
} from '@amarnai/api-client';
import { descendantIds } from '@amarnai/core/taxonomy';
import { minNodeNameLength, minNodeDescriptionLength } from '@amarnai/shared';
import { BottomSheet } from '../BottomSheet';
import { NodePickerSheet, type NodePickerOption } from './NodePickerSheet';
import type { ParentChange } from '../../data/taxonomyQueries';

export type NodeFormSubmit = {
  input: CreateTaxonomyNodeInput;
  // create mode: chosen parent (null = orphan / no edge)
  parentId: string | null;
  // edit mode: present only when the parent actually changed
  parentChange?: ParentChange;
};

interface NodeFormSheetProps {
  visible: boolean;
  mode: 'create' | 'edit';
  node: TaxonomyNode | null;
  nodes: TaxonomyNode[];
  edges: TaxonomyEdge[];
  defaultParentId: string | null;
  submitting: boolean;
  error: string | null;
  // When true the sheet is a details view: inputs are disabled and the save /
  // delete / add-child actions are hidden (used for non-OWNER members).
  readOnly?: boolean;
  onSubmit: (payload: NodeFormSubmit) => void;
  onDelete: (moveToNodeId?: string) => void;
  onAddChild?: (parentId: string) => void;
  onClose: () => void;
}

// Collapsible description-writing guidance, mirroring the web NodeForm's
// DescriptionTips disclosure.
function DescriptionTips() {
  const [open, setOpen] = useState(false);
  return (
    <View style={styles.tips}>
      <TouchableOpacity
        style={styles.tipsToggle}
        onPress={() => setOpen((v) => !v)}
        hitSlop={6}
      >
        <Ionicons
          name={open ? 'chevron-down' : 'chevron-forward'}
          size={12}
          color={colors.accent}
        />
        <Text style={styles.tipsToggleText}>
          {open ? (
            <Trans>Hide tips</Trans>
          ) : (
            <Trans>How to write a good description</Trans>
          )}
        </Text>
      </TouchableOpacity>
      {open ? (
        <View style={styles.tipsBox}>
          <Text style={styles.tipsText}>
            <Trans>
              Describe what kinds of emails belong here: who they come from and
              what they are about. Be specific and use the actual names, topics,
              and words that show up in those emails. Describe what the emails
              are, not what you plan to do about them. The clearer your
              description, the more accurately your email is sorted here.
            </Trans>
          </Text>
          <View style={styles.tipsGood}>
            <Ionicons name="checkmark-circle" size={14} color={colors.okInk} />
            <Text style={styles.tipsGoodText}>
              <Trans>
                Receipts, payment confirmations, and billing questions from
                vendors.
              </Trans>
            </Text>
          </View>
          <View style={styles.tipsBad}>
            <Ionicons name="close-circle" size={14} color={colors.dangerInk} />
            <Text style={styles.tipsBadText}>
              <Trans>Emails about my bills that I need to deal with.</Trans>
            </Text>
          </View>
        </View>
      ) : null}
    </View>
  );
}

export function NodeFormSheet({
  visible,
  mode,
  node,
  nodes,
  edges,
  defaultParentId,
  submitting,
  error,
  readOnly = false,
  onSubmit,
  onDelete,
  onAddChild,
  onClose,
}: NodeFormSheetProps) {
  const { bottom } = useSafeAreaInsets();
  const { _ } = useLingui();
  const isRoot = node?.isRoot ?? false;
  const rootNode = useMemo(() => nodes.find((n) => n.isRoot) ?? null, [nodes]);

  // Existing incoming edge (the node's current parent) in edit mode.
  const currentEdge = useMemo(
    () => (node ? edges.find((e) => e.targetNodeId === node.id) ?? null : null),
    [edges, node],
  );
  const currentParentId = currentEdge?.sourceNodeId ?? null;
  const nodeHasChildren = useMemo(
    () => (node ? edges.some((e) => e.sourceNodeId === node.id) : false),
    [edges, node],
  );

  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [draftPrompt, setDraftPrompt] = useState('');
  const [parentId, setParentId] = useState<string | null>(null);
  const [parentPickerOpen, setParentPickerOpen] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [reassignTargetId, setReassignTargetId] = useState<string | null>(null);
  const [reassignPickerOpen, setReassignPickerOpen] = useState(false);

  // Reset fields whenever the sheet opens for a (possibly different) node.
  useEffect(() => {
    if (!visible) return;
    setName(node?.name ?? '');
    setDescription(node?.description ?? '');
    setDraftPrompt(node?.draftPrompt ?? '');
    setParentId(mode === 'create' ? defaultParentId ?? rootNode?.id ?? null : currentParentId);
    setParentPickerOpen(false);
    setConfirmingDelete(false);
    setReassignTargetId(null);
    setReassignPickerOpen(false);
    // currentParentId derives from node/edges; node id is the stable trigger.
  }, [visible, node?.id, mode, currentParentId, defaultParentId, rootNode?.id]);

  const nameValid =
    name.trim().length >= minNodeNameLength(name) && name.trim().length <= 40;
  const minDescriptionLength = minNodeDescriptionLength(description);
  const descriptionLength = description.replace(/\s/g, '').length;
  const descriptionValid = isRoot || descriptionLength >= minDescriptionLength;
  const canSave = !submitting && nameValid && descriptionValid;

  // Parent options exclude the node itself and its descendants (cycle guard;
  // server is the final authority). Root is offered as a top-level parent.
  const parentOptions = useMemo<NodePickerOption[]>(() => {
    const excluded = node
      ? new Set<string>([node.id, ...descendantIds(edges, node.id)])
      : new Set<string>();
    const opts: NodePickerOption[] = nodes
      .filter((n) => !excluded.has(n.id))
      .map((n) => ({
        id: n.id,
        label: n.isRoot ? _(msg`Inbox`) : n.name,
        ...(n.isRoot ? { sublabel: _(msg`Inbox (entry point)`) } : {}),
      }));
    return [
      ...opts,
      {
        id: null,
        label: _(msg`None (not connected)`),
        sublabel: _(msg`Folder will be ignored until connected`),
      },
    ];
  }, [nodes, edges, node, _]);

  const reassignOptions = useMemo<NodePickerOption[]>(() => {
    const opts: NodePickerOption[] = nodes
      .filter((n) => !n.isRoot && n.id !== node?.id)
      .map((n) => ({ id: n.id, label: n.name }));
    return [{ id: null, label: _(msg`Leave unsorted`) }, ...opts];
  }, [nodes, node, _]);

  const parentLabel =
    parentId === null
      ? _(msg`None (not connected)`)
      : nodes.find((n) => n.id === parentId)?.name ?? _(msg`Unknown`);
  const reassignLabel =
    reassignTargetId === null
      ? _(msg`Leave unsorted`)
      : nodes.find((n) => n.id === reassignTargetId)?.name ?? _(msg`Unknown`);

  function handleSubmit() {
    const desc = description.trim();
    const input: CreateTaxonomyNodeInput = {
      name: name.trim(),
      draftPrompt: draftPrompt.trim() || null,
      ...(desc ? { description: desc } : {}),
    };
    if (mode === 'create') {
      onSubmit({ input, parentId });
    } else if (!isRoot && parentId !== currentParentId) {
      onSubmit({
        input,
        parentId,
        parentChange: { currentEdgeId: currentEdge?.id ?? null, newParentId: parentId },
      });
    } else {
      onSubmit({ input, parentId });
    }
  }

  function handleDeletePress() {
    if (nodeHasChildren) return;
    if ((node?.threadCount ?? 0) > 0) {
      setConfirmingDelete(true);
    } else {
      onDelete();
    }
  }

  return (
    <>
      <BottomSheet visible={visible} onClose={onClose} keyboardAvoiding>
        <View style={styles.sheet}>
          <View style={styles.header}>
            <Text style={styles.title}>
              {readOnly
                ? _(msg`Folder`)
                : mode === 'create'
                  ? _(msg`New folder`)
                  : isRoot
                    ? _(msg`Edit inbox`)
                    : _(msg`Edit folder`)}
            </Text>
            <TouchableOpacity onPress={onClose} hitSlop={8}>
              <Ionicons name="close" size={22} color={colors.ink3} />
            </TouchableOpacity>
          </View>

            <ScrollView
              style={styles.body}
              contentContainerStyle={styles.bodyContent}
              keyboardShouldPersistTaps="handled"
            >
              {error ? (
                <View style={styles.errorBox}>
                  <Text style={styles.errorText}>{error}</Text>
                </View>
              ) : null}

              <Text style={styles.label}>
                <Trans>Name</Trans>
                {readOnly ? '' : ' *'}
              </Text>
              <TextInput
                style={styles.input}
                value={name}
                onChangeText={setName}
                editable={!readOnly}
                placeholder={_(msg`e.g. Invoices`)}
                placeholderTextColor={colors.ink4}
                maxLength={40}
                autoCapitalize="sentences"
              />

              {!isRoot ? (
                <>
                  <Text style={styles.label}>
                    <Trans>Description</Trans>
                    {readOnly ? '' : ' *'}
                  </Text>
                  <TextInput
                    style={[styles.input, styles.textarea]}
                    value={description}
                    onChangeText={setDescription}
                    editable={!readOnly}
                    placeholder={_(
                      msg`Invoices, receipts, and billing questions from clients and vendors.`,
                    )}
                    placeholderTextColor={colors.ink4}
                    maxLength={300}
                    multiline
                  />
                  {!readOnly ? (
                    <>
                      <Text style={styles.hint}>
                        <Trans>
                          List the senders, topics, and keywords that belong
                          here. At least {minDescriptionLength} characters. (
                          {descriptionLength}/{minDescriptionLength})
                        </Trans>
                      </Text>
                      <DescriptionTips />
                    </>
                  ) : null}
                </>
              ) : null}

              {!isRoot ? (
                <>
                  <Text style={styles.label}>
                    <Trans>Parent</Trans>
                  </Text>
                  <TouchableOpacity
                    style={styles.select}
                    onPress={() => setParentPickerOpen(true)}
                    disabled={readOnly}
                  >
                    <Text style={styles.selectText} numberOfLines={1}>
                      {parentLabel}
                    </Text>
                    {readOnly ? null : (
                      <Text style={styles.selectChevron}>
                        <Trans>Change</Trans>
                      </Text>
                    )}
                  </TouchableOpacity>
                </>
              ) : null}

              <Text style={styles.label}>
                <Trans>Draft style guidance</Trans>
              </Text>
              <TextInput
                style={[styles.input, styles.textarea]}
                value={draftPrompt}
                onChangeText={setDraftPrompt}
                editable={!readOnly}
                placeholder={_(
                  msg`e.g. Reply formally. Keep responses under 3 sentences.`,
                )}
                placeholderTextColor={colors.ink4}
                maxLength={500}
                multiline
              />
              {!readOnly ? (
                <Text style={styles.hint}>
                  <Trans>
                    Optional. Applied when generating draft replies for this
                    folder.
                  </Trans>
                </Text>
              ) : null}

              {!readOnly && mode === 'edit' && onAddChild && node ? (
                <TouchableOpacity
                  style={styles.addChild}
                  onPress={() => onAddChild(node.id)}
                >
                  <Text style={styles.addChildText}>
                    <Trans>+ Add folder</Trans>
                  </Text>
                </TouchableOpacity>
              ) : null}

              {!readOnly && mode === 'edit' && !isRoot ? (
                confirmingDelete ? (
                  <View style={styles.deleteBlock}>
                    <Text style={styles.deleteWarn}>
                      <Plural
                        value={node?.threadCount ?? 0}
                        one="Deleting leaves # thread without this folder."
                        other="Deleting leaves # threads without this folder."
                      />
                    </Text>
                    <Text style={styles.label}>
                      <Trans>Move them to</Trans>
                    </Text>
                    <TouchableOpacity
                      style={styles.select}
                      onPress={() => setReassignPickerOpen(true)}
                    >
                      <Text style={styles.selectText}>{reassignLabel}</Text>
                      <Text style={styles.selectChevron}>
                        <Trans>Change</Trans>
                      </Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      style={[styles.btn, styles.btnDanger]}
                      onPress={() => onDelete(reassignTargetId ?? undefined)}
                      disabled={submitting}
                    >
                      <Text style={styles.btnDangerText}>
                        {submitting ? (
                          <Trans>Deleting...</Trans>
                        ) : (
                          <Trans>Confirm delete</Trans>
                        )}
                      </Text>
                    </TouchableOpacity>
                  </View>
                ) : (
                  <TouchableOpacity
                    style={[styles.deleteLink, nodeHasChildren && styles.deleteLinkDisabled]}
                    onPress={handleDeletePress}
                    disabled={submitting || nodeHasChildren}
                  >
                    <Text
                      style={[
                        styles.deleteLinkText,
                        nodeHasChildren && styles.deleteLinkTextDisabled,
                      ]}
                    >
                      <Trans>Delete folder</Trans>
                    </Text>
                  </TouchableOpacity>
                )
              ) : null}

              {!readOnly && mode === 'edit' && nodeHasChildren ? (
                <Text style={styles.hint}>
                  <Trans>Remove its child folders before deleting this one.</Trans>
                </Text>
              ) : null}
            </ScrollView>

            {!readOnly ? (
              <View style={[styles.footer, { paddingBottom: space.xxl + bottom }]}>
                <TouchableOpacity
                  style={[styles.btn, styles.btnPrimary, !canSave && styles.btnDisabled]}
                  onPress={handleSubmit}
                  disabled={!canSave}
                >
                  <Text style={styles.btnPrimaryText}>
                    {submitting ? (
                      <Trans>Saving...</Trans>
                    ) : mode === 'create' ? (
                      <Trans>Create</Trans>
                    ) : (
                      <Trans>Save</Trans>
                    )}
                  </Text>
                </TouchableOpacity>
              </View>
            ) : null}
        </View>
      </BottomSheet>

      <NodePickerSheet
        visible={parentPickerOpen}
        title={_(msg`Choose parent`)}
        options={parentOptions}
        selectedId={parentId}
        onSelect={(id) => {
          setParentId(id);
          setParentPickerOpen(false);
        }}
        onClose={() => setParentPickerOpen(false)}
      />
      <NodePickerSheet
        visible={reassignPickerOpen}
        title={_(msg`Move threads to`)}
        options={reassignOptions}
        selectedId={reassignTargetId}
        onSelect={(id) => {
          setReassignTargetId(id);
          setReassignPickerOpen(false);
        }}
        onClose={() => setReassignPickerOpen(false)}
      />
    </>
  );
}

const styles = StyleSheet.create({
  sheet: {
    backgroundColor: colors.bg,
    borderTopLeftRadius: radii.xl,
    borderTopRightRadius: radii.xl,
    // Shrink within the sheet's height cap (set in BottomSheet) so the form
    // scrolls; clip rounded corners against scrolled content.
    flexShrink: 1,
    overflow: 'hidden',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: space.xl,
    paddingTop: space.lg,
    paddingBottom: space.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.line2,
  },
  title: {
    fontSize: fontSize.xl,
    fontWeight: fontWeight.semibold,
    color: colors.ink,
  },
  body: { paddingHorizontal: space.xl, flexShrink: 1 },
  bodyContent: { paddingVertical: space.lg, gap: space.xs },
  label: {
    fontSize: fontSize.sm,
    fontWeight: fontWeight.semibold,
    color: colors.ink2,
    marginTop: space.md,
    marginBottom: space.xs,
  },
  input: {
    borderWidth: 1,
    borderColor: colors.line2,
    borderRadius: radii.md,
    backgroundColor: colors.surface,
    paddingHorizontal: space.lg,
    paddingVertical: space.md,
    fontSize: fontSize.md,
    color: colors.ink,
  },
  textarea: {
    minHeight: 72,
    textAlignVertical: 'top',
  },
  hint: {
    fontSize: fontSize.xs,
    color: colors.ink3,
    marginTop: space.xs,
  },
  tips: {
    marginTop: space.xs,
  },
  tipsToggle: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.xxs,
    paddingVertical: space.xxs,
  },
  tipsToggleText: {
    fontSize: fontSize.xs,
    color: colors.accent,
    fontWeight: fontWeight.medium,
  },
  tipsBox: {
    marginTop: space.sm,
    padding: space.md,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.line2,
    borderRadius: radii.md,
    gap: space.sm,
  },
  tipsText: {
    fontSize: fontSize.xs,
    color: colors.ink2,
    lineHeight: 18,
  },
  tipsGood: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: space.xs,
    backgroundColor: colors.okSoft,
    borderRadius: radii.sm,
    padding: space.sm,
  },
  tipsGoodText: {
    flex: 1,
    fontSize: fontSize.xs,
    color: colors.okInk,
  },
  tipsBad: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: space.xs,
    backgroundColor: colors.dangerSoft,
    borderRadius: radii.sm,
    padding: space.sm,
  },
  tipsBadText: {
    flex: 1,
    fontSize: fontSize.xs,
    color: colors.dangerInk,
  },
  select: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderWidth: 1,
    borderColor: colors.line2,
    borderRadius: radii.md,
    backgroundColor: colors.surface,
    paddingHorizontal: space.lg,
    paddingVertical: space.md,
  },
  selectText: {
    flex: 1,
    fontSize: fontSize.md,
    color: colors.ink,
  },
  selectChevron: {
    fontSize: fontSize.sm,
    color: colors.accent,
    fontWeight: fontWeight.medium,
    marginLeft: space.md,
  },
  errorBox: {
    backgroundColor: colors.dangerSoft,
    borderWidth: 1,
    borderColor: colors.dangerLine,
    borderRadius: radii.md,
    padding: space.md,
    marginBottom: space.sm,
  },
  errorText: {
    fontSize: fontSize.sm,
    color: colors.dangerInk,
  },
  addChild: {
    marginTop: space.lg,
    paddingVertical: space.md,
  },
  addChildText: {
    fontSize: fontSize.md,
    color: colors.accent,
    fontWeight: fontWeight.medium,
  },
  deleteBlock: {
    marginTop: space.lg,
    gap: space.xs,
  },
  deleteWarn: {
    fontSize: fontSize.sm,
    color: colors.warnInk,
    backgroundColor: colors.warnSoft,
    borderRadius: radii.md,
    padding: space.md,
  },
  deleteLink: {
    marginTop: space.lg,
    paddingVertical: space.md,
    alignItems: 'center',
  },
  deleteLinkDisabled: {
    opacity: 0.5,
  },
  deleteLinkText: {
    fontSize: fontSize.md,
    color: colors.danger,
    fontWeight: fontWeight.medium,
  },
  deleteLinkTextDisabled: {
    color: colors.ink4,
  },
  footer: {
    paddingHorizontal: space.xl,
    paddingTop: space.md,
    // paddingBottom is applied inline (space.xxl + safe-area inset) so the save
    // button clears the Android navigation buttons.
    borderTopWidth: 1,
    borderTopColor: colors.line2,
  },
  btn: {
    borderRadius: radii.md,
    paddingVertical: space.lg,
    alignItems: 'center',
  },
  btnPrimary: {
    backgroundColor: colors.accent,
  },
  btnPrimaryText: {
    color: colors.surface,
    fontSize: fontSize.md,
    fontWeight: fontWeight.semibold,
  },
  btnDisabled: {
    backgroundColor: colors.ink5,
  },
  btnDanger: {
    backgroundColor: colors.danger,
    marginTop: space.sm,
  },
  btnDangerText: {
    color: colors.surface,
    fontSize: fontSize.md,
    fontWeight: fontWeight.semibold,
  },
});
