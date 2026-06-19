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
import { colors, radii, space, fontSize, fontWeight } from '@amarnai/tokens';
import type {
  CreateTaxonomyNodeInput,
  TaxonomyEdge,
  TaxonomyNode,
} from '@amarnai/api-client';
import { descendantIds } from '../../taxonomy/buildTree';
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

const NONE_OPTION: NodePickerOption = {
  id: null,
  label: 'None (not connected)',
  sublabel: 'Node will be ignored until connected',
};

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
          {open ? 'Hide tips' : 'How to write a good description'}
        </Text>
      </TouchableOpacity>
      {open ? (
        <View style={styles.tipsBox}>
          <Text style={styles.tipsText}>
            Describe what kinds of emails belong here: who they come from and what
            they are about. Be specific and use the actual names, topics, and words
            that show up in those emails. Describe what the emails are, not what you
            plan to do about them. The clearer your description, the more accurately
            your email is sorted here.
          </Text>
          <View style={styles.tipsGood}>
            <Ionicons name="checkmark-circle" size={14} color={colors.okInk} />
            <Text style={styles.tipsGoodText}>
              Receipts, payment confirmations, and billing questions from vendors.
            </Text>
          </View>
          <View style={styles.tipsBad}>
            <Ionicons name="close-circle" size={14} color={colors.dangerInk} />
            <Text style={styles.tipsBadText}>
              Emails about my bills that I need to deal with.
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

  const nameValid = name.trim().length >= 3 && name.trim().length <= 40;
  const descriptionValid = isRoot || description.replace(/\s/g, '').length >= 30;
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
        label: n.name,
        ...(n.isRoot ? { sublabel: 'Inbox (entry point)' } : {}),
      }));
    return [...opts, NONE_OPTION];
  }, [nodes, edges, node]);

  const reassignOptions = useMemo<NodePickerOption[]>(() => {
    const opts: NodePickerOption[] = nodes
      .filter((n) => !n.isRoot && n.id !== node?.id)
      .map((n) => ({ id: n.id, label: n.name }));
    return [{ id: null, label: 'Leave unsorted' }, ...opts];
  }, [nodes, node]);

  const parentLabel =
    parentId === null
      ? 'None (not connected)'
      : nodes.find((n) => n.id === parentId)?.name ?? 'Unknown';
  const reassignLabel =
    reassignTargetId === null
      ? 'Leave unsorted'
      : nodes.find((n) => n.id === reassignTargetId)?.name ?? 'Unknown';

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
                ? 'Category'
                : mode === 'create'
                  ? 'New category'
                  : isRoot
                    ? 'Edit inbox'
                    : 'Edit category'}
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

              <Text style={styles.label}>Name{readOnly ? '' : ' *'}</Text>
              <TextInput
                style={styles.input}
                value={name}
                onChangeText={setName}
                editable={!readOnly}
                placeholder="e.g. Invoices"
                placeholderTextColor={colors.ink4}
                maxLength={40}
                autoCapitalize="sentences"
              />

              {!isRoot ? (
                <>
                  <Text style={styles.label}>Description{readOnly ? '' : ' *'}</Text>
                  <TextInput
                    style={[styles.input, styles.textarea]}
                    value={description}
                    onChangeText={setDescription}
                    editable={!readOnly}
                    placeholder="Invoices, receipts, and billing questions from clients and vendors."
                    placeholderTextColor={colors.ink4}
                    maxLength={300}
                    multiline
                  />
                  {!readOnly ? (
                    <>
                      <Text style={styles.hint}>
                        List the senders, topics, and keywords that belong here. At least 30
                        characters. ({description.replace(/\s/g, '').length}/30)
                      </Text>
                      <DescriptionTips />
                    </>
                  ) : null}
                </>
              ) : null}

              {!isRoot ? (
                <>
                  <Text style={styles.label}>Parent</Text>
                  <TouchableOpacity
                    style={styles.select}
                    onPress={() => setParentPickerOpen(true)}
                    disabled={readOnly}
                  >
                    <Text style={styles.selectText} numberOfLines={1}>
                      {parentLabel}
                    </Text>
                    {readOnly ? null : <Text style={styles.selectChevron}>Change</Text>}
                  </TouchableOpacity>
                </>
              ) : null}

              <Text style={styles.label}>Draft style guidance</Text>
              <TextInput
                style={[styles.input, styles.textarea]}
                value={draftPrompt}
                onChangeText={setDraftPrompt}
                editable={!readOnly}
                placeholder="e.g. Reply formally. Keep responses under 3 sentences."
                placeholderTextColor={colors.ink4}
                maxLength={500}
                multiline
              />
              {!readOnly ? (
                <Text style={styles.hint}>
                  Optional. Applied when generating draft replies for this category.
                </Text>
              ) : null}

              {!readOnly && mode === 'edit' && onAddChild && node ? (
                <TouchableOpacity
                  style={styles.addChild}
                  onPress={() => onAddChild(node.id)}
                >
                  <Text style={styles.addChildText}>+ Add subcategory</Text>
                </TouchableOpacity>
              ) : null}

              {!readOnly && mode === 'edit' && !isRoot ? (
                confirmingDelete ? (
                  <View style={styles.deleteBlock}>
                    <Text style={styles.deleteWarn}>
                      Deleting leaves {node?.threadCount} thread
                      {node?.threadCount === 1 ? '' : 's'} without this category.
                    </Text>
                    <Text style={styles.label}>Move them to</Text>
                    <TouchableOpacity
                      style={styles.select}
                      onPress={() => setReassignPickerOpen(true)}
                    >
                      <Text style={styles.selectText}>{reassignLabel}</Text>
                      <Text style={styles.selectChevron}>Change</Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      style={[styles.btn, styles.btnDanger]}
                      onPress={() => onDelete(reassignTargetId ?? undefined)}
                      disabled={submitting}
                    >
                      <Text style={styles.btnDangerText}>
                        {submitting ? 'Deleting...' : 'Confirm delete'}
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
                      Delete category
                    </Text>
                  </TouchableOpacity>
                )
              ) : null}

              {!readOnly && mode === 'edit' && nodeHasChildren ? (
                <Text style={styles.hint}>
                  Remove its subcategories before deleting this one.
                </Text>
              ) : null}
            </ScrollView>

            {!readOnly ? (
              <View style={styles.footer}>
                <TouchableOpacity
                  style={[styles.btn, styles.btnPrimary, !canSave && styles.btnDisabled]}
                  onPress={handleSubmit}
                  disabled={!canSave}
                >
                  <Text style={styles.btnPrimaryText}>
                    {submitting ? 'Saving...' : mode === 'create' ? 'Create' : 'Save'}
                  </Text>
                </TouchableOpacity>
              </View>
            ) : null}
        </View>
      </BottomSheet>

      <NodePickerSheet
        visible={parentPickerOpen}
        title="Choose parent"
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
        title="Move threads to"
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
    maxHeight: '92%',
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
  body: { paddingHorizontal: space.xl },
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
    paddingBottom: space.xxl,
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
