import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  RefreshControl,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { countRoutableNonRootNodes, TAXONOMY_MIN_NON_ROOT_NODES } from '@amarnai/shared';
import type { TaxonomyTransferFile } from '@amarnai/shared';
import { TAXONOMY_TEMPLATES, matchesTemplate } from '@amarnai/core/taxonomy';
import type { Toast as ToastModel } from '@amarnai/core';
import type { TaxonomyNode } from '@amarnai/api-client';
import { colors, radii, space, fontSize, fontWeight } from '@amarnai/tokens';
import { useSession } from '../../../../src/auth/session';
import {
  useApplyTemplate,
  useCreateNode,
  useDeleteNode,
  useTaxonomyEdges,
  useTaxonomyNodes,
  useUpdateNode,
} from '../../../../src/data/taxonomyQueries';
import {
  buildTaxonomyTree,
  flattenVisible,
  type TaxonomyTreeRow,
} from '../../../../src/taxonomy/buildTree';
import { AppHeader } from '../../../../src/components/AppHeader';
import { Toast } from '../../../../src/components/Toast';
import { TaxonomyNodeRow } from '../../../../src/components/taxonomy/TaxonomyNodeRow';
import {
  NodeFormSheet,
  type NodeFormSubmit,
} from '../../../../src/components/taxonomy/NodeFormSheet';
import { TemplatePickerSheet } from '../../../../src/components/taxonomy/TemplatePickerSheet';
import { RoutingIndicator } from '../../../../src/components/taxonomy/RoutingIndicator';

type FormState =
  | { mode: 'create'; node: null; defaultParentId: string | null }
  | { mode: 'edit'; node: TaxonomyNode; defaultParentId: null };

export default function TaxonomyScreen() {
  const { workspaceId, userId, workspaces } = useSession();
  const ws = workspaceId ?? '';

  const nodesQ = useTaxonomyNodes(ws);
  const edgesQ = useTaxonomyEdges(ws);
  const createNode = useCreateNode(ws);
  const updateNode = useUpdateNode(ws);
  const deleteNode = useDeleteNode(ws);
  const applyTemplate = useApplyTemplate(ws);

  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [search, setSearch] = useState('');
  const [form, setForm] = useState<FormState | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [templateOpen, setTemplateOpen] = useState(false);
  const [toast, setToast] = useState<ToastModel | null>(null);

  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const showToast = useCallback((message: string) => {
    setToast({ message });
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), 2800);
  }, []);
  useEffect(
    () => () => {
      if (toastTimer.current) clearTimeout(toastTimer.current);
    },
    [],
  );

  // Editing mirrors the web page: only workspace OWNERs may edit; everyone else
  // gets a read-only view.
  const activeWs = workspaces.find((w) => w.id === workspaceId) ?? null;
  const isOwner =
    !!activeWs &&
    (activeWs.owner.id === userId ||
      activeWs.members.some((m) => m.user.id === userId && m.role === 'OWNER'));
  const readOnly = !isOwner;

  const nodes = nodesQ.data;
  const edges = edgesQ.data;

  const tree = useMemo(
    () => (nodes && edges ? buildTaxonomyTree(nodes, edges) : null),
    [nodes, edges],
  );

  const searching = search.trim().length > 0;
  const rows = useMemo<TaxonomyTreeRow[]>(() => {
    if (!tree) return [];
    if (searching) {
      const q = search.trim().toLowerCase();
      return tree.rows.filter((r) => r.node.name.toLowerCase().includes(q));
    }
    return flattenVisible(tree, collapsed);
  }, [tree, searching, search, collapsed]);

  // The template matching the current taxonomy (if any) is shown as "Current"
  // and cannot be re-applied.
  const currentTemplateId = useMemo(
    () =>
      nodes && edges
        ? TAXONOMY_TEMPLATES.find((t) => matchesTemplate(nodes, edges, t))?.id ?? null
        : null,
    [nodes, edges],
  );

  const routableCount = useMemo(
    () =>
      nodes && edges
        ? countRoutableNonRootNodes(
            nodes.map((n) => ({ id: n.id, isRoot: n.isRoot })),
            edges.map((e) => ({ sourceNodeId: e.sourceNodeId, targetNodeId: e.targetNodeId })),
          )
        : 0,
    [nodes, edges],
  );

  const refetch = useCallback(() => {
    void nodesQ.refetch();
    void edgesQ.refetch();
  }, [nodesQ, edgesQ]);

  const toggle = (id: string) =>
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const openCreate = (parentId: string | null) => {
    setFormError(null);
    setForm({ mode: 'create', node: null, defaultParentId: parentId });
  };
  const openNode = (node: TaxonomyNode) => {
    setFormError(null);
    setForm({ mode: 'edit', node, defaultParentId: null });
  };

  const submitting = createNode.isPending || updateNode.isPending || deleteNode.isPending;

  const handleSubmit = async (payload: NodeFormSubmit) => {
    setFormError(null);
    try {
      if (form?.mode === 'create') {
        await createNode.mutateAsync({ input: payload.input, parentId: payload.parentId });
        showToast('Category created');
      } else if (form?.mode === 'edit') {
        await updateNode.mutateAsync({
          nodeId: form.node.id,
          input: payload.input,
          ...(payload.parentChange ? { parentChange: payload.parentChange } : {}),
        });
        showToast('Category updated');
      }
      setForm(null);
    } catch (err) {
      setFormError(err instanceof Error ? err.message : 'Something went wrong');
    }
  };

  const handleDelete = async (moveToNodeId?: string) => {
    if (form?.mode !== 'edit') return;
    setFormError(null);
    try {
      await deleteNode.mutateAsync({
        nodeId: form.node.id,
        ...(moveToNodeId ? { moveToNodeId } : {}),
      });
      showToast('Category deleted');
      setForm(null);
    } catch (err) {
      setFormError(err instanceof Error ? err.message : 'Delete failed');
    }
  };

  const handleApplyTemplate = async (file: TaxonomyTransferFile) => {
    try {
      await applyTemplate.mutateAsync(file);
      setTemplateOpen(false);
      showToast('Template applied');
    } catch (err) {
      setTemplateOpen(false);
      showToast(err instanceof Error ? err.message : 'Could not apply template');
    }
  };

  const loadError = nodesQ.isError || edgesQ.isError;
  const loading = !loadError && (!nodes || !edges);

  return (
    <View style={styles.container}>
      <AppHeader variant="workspace" />

      <View style={styles.subHeader}>
        <Text style={styles.heading}>Taxonomy</Text>
        {!readOnly ? (
          <View style={styles.actions}>
            <TouchableOpacity
              style={styles.iconBtn}
              onPress={() => setTemplateOpen(true)}
              hitSlop={8}
              accessibilityLabel="Browse templates"
            >
              <Ionicons name="sparkles-outline" size={20} color={colors.ink3} />
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.addBtn}
              onPress={() => openCreate(tree?.rootId ?? null)}
            >
              <Ionicons name="add" size={18} color={colors.surface} />
              <Text style={styles.addBtnText}>Add</Text>
            </TouchableOpacity>
          </View>
        ) : null}
      </View>

      {readOnly ? (
        <View style={styles.banner}>
          <Text style={styles.bannerText}>
            View only. Only workspace admins can edit the taxonomy.
          </Text>
        </View>
      ) : null}

      {!loading && !loadError && routableCount < TAXONOMY_MIN_NON_ROOT_NODES ? (
        <RoutingIndicator count={routableCount} min={TAXONOMY_MIN_NON_ROOT_NODES} />
      ) : null}

      <View style={styles.searchWrap}>
        <Ionicons name="search" size={16} color={colors.ink4} />
        <TextInput
          style={styles.searchInput}
          value={search}
          onChangeText={setSearch}
          placeholder="Search categories"
          placeholderTextColor={colors.ink4}
          autoCapitalize="none"
          autoCorrect={false}
        />
        {searching ? (
          <TouchableOpacity onPress={() => setSearch('')} hitSlop={8}>
            <Ionicons name="close-circle" size={16} color={colors.ink4} />
          </TouchableOpacity>
        ) : null}
      </View>

      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator color={colors.accent} />
        </View>
      ) : loadError ? (
        <View style={styles.center}>
          <Text style={styles.empty}>Could not load the taxonomy.</Text>
          <TouchableOpacity onPress={refetch} style={styles.retry}>
            <Text style={styles.retryText}>Retry</Text>
          </TouchableOpacity>
        </View>
      ) : (
        <FlatList
          data={rows}
          keyExtractor={(r) => r.node.id}
          renderItem={({ item }) => (
            <TaxonomyNodeRow
              row={item}
              collapsed={collapsed.has(item.node.id)}
              flat={searching}
              onToggle={() => toggle(item.node.id)}
              onPress={() => openNode(item.node)}
            />
          )}
          refreshControl={
            <RefreshControl
              refreshing={nodesQ.isFetching || edgesQ.isFetching}
              onRefresh={refetch}
              tintColor={colors.accent}
            />
          }
          ListEmptyComponent={
            <Text style={styles.empty}>
              {searching ? 'No matching categories' : 'No categories yet'}
            </Text>
          }
        />
      )}

      {form ? (
        <NodeFormSheet
          visible
          mode={form.mode}
          node={form.node}
          nodes={nodes ?? []}
          edges={edges ?? []}
          defaultParentId={form.mode === 'create' ? form.defaultParentId : null}
          submitting={submitting}
          error={formError}
          readOnly={readOnly}
          onSubmit={handleSubmit}
          onDelete={handleDelete}
          onAddChild={openCreate}
          onClose={() => setForm(null)}
        />
      ) : null}

      <TemplatePickerSheet
        visible={templateOpen}
        templates={TAXONOMY_TEMPLATES}
        currentTemplateId={currentTemplateId}
        applying={applyTemplate.isPending}
        onApply={handleApplyTemplate}
        onClose={() => setTemplateOpen(false)}
      />

      <Toast toast={toast} onUndo={() => setToast(null)} onDismiss={() => setToast(null)} />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.bg,
  },
  subHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: space.xl,
    paddingTop: space.lg,
    paddingBottom: space.md,
  },
  heading: {
    fontSize: fontSize.xxl,
    fontWeight: fontWeight.semibold,
    color: colors.ink,
  },
  actions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.lg,
  },
  iconBtn: {
    padding: space.xxs,
  },
  addBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.xxs,
    backgroundColor: colors.accent,
    borderRadius: radii.md,
    paddingHorizontal: space.lg,
    paddingVertical: space.sm,
  },
  addBtnText: {
    color: colors.surface,
    fontSize: fontSize.md,
    fontWeight: fontWeight.semibold,
  },
  banner: {
    backgroundColor: colors.bgSunk,
    paddingHorizontal: space.xl,
    paddingVertical: space.md,
    marginHorizontal: space.xl,
    borderRadius: radii.md,
    marginBottom: space.md,
  },
  bannerText: {
    fontSize: fontSize.sm,
    color: colors.ink3,
  },
  searchWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    marginHorizontal: space.xl,
    marginBottom: space.md,
    paddingHorizontal: space.lg,
    paddingVertical: space.sm,
    backgroundColor: colors.bgSunk,
    borderRadius: radii.md,
  },
  searchInput: {
    flex: 1,
    fontSize: fontSize.md,
    color: colors.ink,
    paddingVertical: 0,
  },
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: space.lg,
  },
  empty: {
    fontSize: fontSize.md,
    color: colors.ink3,
    textAlign: 'center',
    marginTop: space.xxl,
  },
  retry: {
    paddingHorizontal: space.xl,
    paddingVertical: space.md,
    borderRadius: radii.md,
    backgroundColor: colors.bgSunk,
  },
  retryText: {
    fontSize: fontSize.md,
    color: colors.accent,
    fontWeight: fontWeight.medium,
  },
});
