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
import { Trans } from '@lingui/react/macro';
import { msg } from '@lingui/core/macro';
import { useLingui } from '@lingui/react';
import { translateSource } from '@amarnai/i18n';
import { countRoutableNonRootNodes, TAXONOMY_MIN_NON_ROOT_NODES } from '@amarnai/shared';
import type { TaxonomyTransferFile } from '@amarnai/shared';
import { TAXONOMY_TEMPLATES, matchesTemplate, localizeTemplate } from '@amarnai/core/taxonomy';
import type { Toast as ToastModel } from '@amarnai/core';
import type { TaxonomyNode } from '@amarnai/api-client';
import { colors, radii, space, fontSize, fontWeight } from '@amarnai/tokens';
import { useSession } from '../../../../src/auth/session';
import {
  useApplyTemplate,
  useCreateNode,
  useDeleteNode,
  useGenerateTaxonomy,
  useTaxonomyEdges,
  useTaxonomyGeneration,
  useTaxonomyNodes,
  useUpdateNode,
} from '../../../../src/data/taxonomyQueries';
import { useGmailConnection } from '../../../../src/data/queries';
import { useConnectGmail } from '../../../../src/auth/useConnectGmail';
import {
  buildTaxonomyTree,
  flattenVisible,
  type TaxonomyTreeRow,
} from '../../../../src/taxonomy/buildTree';
import { AppHeader } from '../../../../src/components/AppHeader';
import { Toast } from '../../../../src/components/Toast';
import { ScreenContainer } from '../../../../src/components/ScreenContainer';
import { CenterView } from '../../../../src/components/CenterView';
import { TaxonomyNodeRow } from '../../../../src/components/taxonomy/TaxonomyNodeRow';
import {
  NodeFormSheet,
  type NodeFormSubmit,
} from '../../../../src/components/taxonomy/NodeFormSheet';
import { TemplatePickerSheet } from '../../../../src/components/taxonomy/TemplatePickerSheet';
import { GenerateFromInboxSheet } from '../../../../src/components/taxonomy/GenerateFromInboxSheet';
import { RoutingIndicator } from '../../../../src/components/taxonomy/RoutingIndicator';
import { toUserMessage } from '../../../../src/errors';

type FormState =
  | { mode: 'create'; node: null; defaultParentId: string | null }
  | { mode: 'edit'; node: TaxonomyNode; defaultParentId: null };

export default function TaxonomyScreen() {
  const { i18n, _ } = useLingui();
  const { workspaceId, userId, workspaces, client } = useSession();
  const ws = workspaceId ?? '';

  const nodesQ = useTaxonomyNodes(ws);
  const edgesQ = useTaxonomyEdges(ws);
  const createNode = useCreateNode(ws);
  const updateNode = useUpdateNode(ws);
  const deleteNode = useDeleteNode(ws);
  const applyTemplate = useApplyTemplate(ws);
  const generateTaxonomy = useGenerateTaxonomy(ws);

  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [search, setSearch] = useState('');
  const [form, setForm] = useState<FormState | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [templateOpen, setTemplateOpen] = useState(false);
  const [generateOpen, setGenerateOpen] = useState(false);
  const [toast, setToast] = useState<ToastModel | null>(null);

  const generationQ = useTaxonomyGeneration(ws, generateOpen);

  // "Generate from inbox" needs a connected inbox to analyze. With none, opening
  // the generator would wrongly report "not enough variety", so we run the Gmail
  // connect flow first (mirrors the web app, which sends the user to OAuth).
  const connectionQ = useGmailConnection(ws);
  const gmailConnected = connectionQ.data?.status === 'ACTIVE';
  const { connect: connectGmail } = useConnectGmail(ws, client);

  const handleOpenGenerate = useCallback(() => {
    if (gmailConnected) {
      setGenerateOpen(true);
      return;
    }
    void connectGmail(() => void connectionQ.refetch());
  }, [gmailConnected, connectGmail, connectionQ]);

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

  // Templates are English data; localize names/descriptions (picker + every
  // folder) into the active locale once, then drive display, the "current"
  // match, and apply from this single array so persisted names match what the
  // user sees and what matchesTemplate compares against.
  const localizedTemplates = useMemo(
    () => TAXONOMY_TEMPLATES.map((t) => localizeTemplate(t, (s) => translateSource(i18n, s))),
    [i18n],
  );

  // The template matching the current taxonomy (if any) is shown as "Current"
  // and cannot be re-applied.
  const currentTemplateId = useMemo(
    () =>
      nodes && edges
        ? localizedTemplates.find((t) => matchesTemplate(nodes, edges, t))?.id ?? null
        : null,
    [nodes, edges, localizedTemplates],
  );

  const routableCount = useMemo(
    () =>
      nodes && edges
        ? countRoutableNonRootNodes(
            nodes.map((n) => ({ id: n.id, isRoot: n.isRoot, isCatchAll: n.isCatchAll })),
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
        showToast(_(msg`Folder created`));
      } else if (form?.mode === 'edit') {
        await updateNode.mutateAsync({
          nodeId: form.node.id,
          input: payload.input,
          ...(payload.parentChange ? { parentChange: payload.parentChange } : {}),
        });
        showToast(_(msg`Folder updated`));
      }
      setForm(null);
    } catch (err) {
      setFormError(toUserMessage(err, _(msg`Something went wrong. Please try again.`)));
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
      showToast(_(msg`Folder deleted`));
      setForm(null);
    } catch (err) {
      setFormError(toUserMessage(err, _(msg`Delete failed. Please try again.`)));
    }
  };

  const handleApplyTemplate = async (file: TaxonomyTransferFile) => {
    try {
      await applyTemplate.mutateAsync(file);
      setTemplateOpen(false);
      showToast(_(msg`Template applied`));
    } catch (err) {
      setTemplateOpen(false);
      showToast(toUserMessage(err, _(msg`Could not apply template. Please try again.`)));
    }
  };

  const handleGenerate = async () => {
    try {
      await generateTaxonomy.mutateAsync();
    } catch (err) {
      showToast(toUserMessage(err, _(msg`Could not start generation. Please try again.`)));
    }
  };

  const handleApplyProposal = async (file: TaxonomyTransferFile) => {
    try {
      await applyTemplate.mutateAsync(file);
      setGenerateOpen(false);
      showToast(_(msg`Taxonomy applied`));
    } catch (err) {
      setGenerateOpen(false);
      showToast(toUserMessage(err, _(msg`Could not apply taxonomy. Please try again.`)));
    }
  };

  const loadError = nodesQ.isError || edgesQ.isError;
  const loading = !loadError && (!nodes || !edges);

  return (
    <ScreenContainer>
      <AppHeader variant="workspace" />

      <View style={styles.subHeader}>
        <Text style={styles.heading}>
          <Trans comment="Screen heading for the email-sorting taxonomy. Not a billing or subscription plan.">
            Plan
          </Trans>
        </Text>
        {!readOnly ? (
          <View style={styles.actions}>
            <TouchableOpacity
              style={styles.iconBtn}
              onPress={handleOpenGenerate}
              hitSlop={8}
              accessibilityLabel={_(msg`Generate plan from inbox`)}
            >
              <Ionicons name="color-wand-outline" size={20} color={colors.ink3} />
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.iconBtn}
              onPress={() => setTemplateOpen(true)}
              hitSlop={8}
              accessibilityLabel={_(msg`Browse templates`)}
            >
              <Ionicons name="sparkles-outline" size={20} color={colors.ink3} />
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.addBtn}
              onPress={() => openCreate(tree?.rootId ?? null)}
            >
              <Ionicons name="add" size={18} color={colors.surface} />
              <Text style={styles.addBtnText}>
                <Trans>Add</Trans>
              </Text>
            </TouchableOpacity>
          </View>
        ) : null}
      </View>

      {readOnly ? (
        <View style={styles.banner}>
          <Text style={styles.bannerText}>
            <Trans>View only. Only workspace admins can edit the plan.</Trans>
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
          placeholder={_(msg`Search folders`)}
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
        <CenterView>
          <ActivityIndicator color={colors.accent} />
        </CenterView>
      ) : loadError ? (
        <CenterView>
          <Text style={styles.empty}>
            <Trans>Could not load the plan.</Trans>
          </Text>
          <TouchableOpacity onPress={refetch} style={styles.retry}>
            <Text style={styles.retryText}>
              <Trans>Retry</Trans>
            </Text>
          </TouchableOpacity>
        </CenterView>
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
              // The catch-all is a fixed node and is not editable, so tapping it
              // does not open the edit form (matching the inbox root).
              onPress={() => {
                if (!item.node.isCatchAll) openNode(item.node);
              }}
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
              {searching ? (
                <Trans>No matching folders</Trans>
              ) : (
                <Trans>No folders yet</Trans>
              )}
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
        templates={localizedTemplates}
        currentTemplateId={currentTemplateId}
        applying={applyTemplate.isPending}
        onApply={handleApplyTemplate}
        onClose={() => setTemplateOpen(false)}
      />

      <GenerateFromInboxSheet
        visible={generateOpen}
        generation={generationQ.data}
        loading={generationQ.isLoading}
        generating={generateTaxonomy.isPending}
        applying={applyTemplate.isPending}
        onGenerate={handleGenerate}
        onApply={handleApplyProposal}
        onUseTemplates={() => setTemplateOpen(true)}
        onClose={() => setGenerateOpen(false)}
      />

      <Toast toast={toast} onUndo={() => setToast(null)} onDismiss={() => setToast(null)} />
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
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
