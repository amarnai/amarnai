import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  CreateTaxonomyNodeInput,
  UpdateTaxonomyNodeInput,
} from '@amarnai/api-client';
import type { TaxonomyTransferFile } from '@amarnai/shared';
import { useSession } from '../auth/session';

// Query keys are shared with TriageProvider so the taxonomy cache is one copy.
const nodesKey = (ws: string) => ['taxonomyNodes', ws] as const;
const edgesKey = (ws: string) => ['taxonomyEdges', ws] as const;

export function useTaxonomyNodes(workspaceId: string) {
  const { client } = useSession();
  return useQuery({
    queryKey: nodesKey(workspaceId),
    queryFn: () => client.taxonomyNodes(workspaceId),
    enabled: !!workspaceId,
  });
}

export function useTaxonomyEdges(workspaceId: string) {
  const { client } = useSession();
  return useQuery({
    queryKey: edgesKey(workspaceId),
    queryFn: () => client.taxonomyEdges(workspaceId),
    enabled: !!workspaceId,
  });
}

// Re-fetches both taxonomy lists after a mutation so the tree reflects the server.
function useInvalidateTaxonomy(workspaceId: string) {
  const qc = useQueryClient();
  return () =>
    Promise.all([
      qc.invalidateQueries({ queryKey: nodesKey(workspaceId) }),
      qc.invalidateQueries({ queryKey: edgesKey(workspaceId) }),
    ]);
}

// A node's parent is modelled on mobile as a single "Parent" choice instead of
// the web's standalone edges. The screen passes the existing incoming-edge id (if
// any) so re-parenting can reuse / create / delete the edge as needed.
export type ParentChange = {
  currentEdgeId: string | null;
  newParentId: string | null;
};

export function useCreateNode(workspaceId: string) {
  const { client } = useSession();
  const invalidate = useInvalidateTaxonomy(workspaceId);
  return useMutation({
    mutationFn: async (vars: { input: CreateTaxonomyNodeInput; parentId: string | null }) => {
      const created = await client.createTaxonomyNode(workspaceId, vars.input);
      if (vars.parentId) {
        await client.createTaxonomyEdge(workspaceId, {
          sourceNodeId: vars.parentId,
          targetNodeId: created.id,
        });
      }
      return created;
    },
    onSuccess: invalidate,
  });
}

export function useUpdateNode(workspaceId: string) {
  const { client } = useSession();
  const invalidate = useInvalidateTaxonomy(workspaceId);
  return useMutation({
    mutationFn: async (vars: {
      nodeId: string;
      input: UpdateTaxonomyNodeInput;
      parentChange?: ParentChange;
    }) => {
      await client.updateTaxonomyNode(workspaceId, vars.nodeId, vars.input);
      const pc = vars.parentChange;
      if (!pc) return;
      if (pc.currentEdgeId && pc.newParentId) {
        await client.updateTaxonomyEdge(workspaceId, pc.currentEdgeId, {
          newSourceNodeId: pc.newParentId,
        });
      } else if (pc.currentEdgeId && !pc.newParentId) {
        await client.deleteTaxonomyEdge(workspaceId, pc.currentEdgeId);
      } else if (!pc.currentEdgeId && pc.newParentId) {
        await client.createTaxonomyEdge(workspaceId, {
          sourceNodeId: pc.newParentId,
          targetNodeId: vars.nodeId,
        });
      }
    },
    onSuccess: invalidate,
  });
}

export function useDeleteNode(workspaceId: string) {
  const { client } = useSession();
  const invalidate = useInvalidateTaxonomy(workspaceId);
  return useMutation({
    mutationFn: (vars: { nodeId: string; moveToNodeId?: string }) =>
      client.deleteTaxonomyNode(workspaceId, vars.nodeId, vars.moveToNodeId),
    onSuccess: invalidate,
  });
}

export function useApplyTemplate(workspaceId: string) {
  const { client } = useSession();
  const invalidate = useInvalidateTaxonomy(workspaceId);
  return useMutation({
    mutationFn: (file: TaxonomyTransferFile) => client.importTaxonomy(workspaceId, file),
    onSuccess: invalidate,
  });
}

// ─── Auto-generate taxonomy from inbox ──────────────────────────────────────────

const generationKey = (ws: string) => ['taxonomyGeneration', ws] as const;

// Polls generation status + eligibility. Auto-refreshes every 2.5s while a run
// is in progress, then stops. Pass `enabled` so it only runs while the sheet is
// open.
export function useTaxonomyGeneration(workspaceId: string, enabled: boolean) {
  const { client } = useSession();
  return useQuery({
    queryKey: generationKey(workspaceId),
    queryFn: () => client.taxonomyGeneration(workspaceId),
    enabled: !!workspaceId && enabled,
    refetchInterval: (query) =>
      query.state.data?.status === 'RUNNING' ? 2500 : false,
  });
}

export function useGenerateTaxonomy(workspaceId: string) {
  const { client } = useSession();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => client.generateTaxonomy(workspaceId),
    onSuccess: () => qc.invalidateQueries({ queryKey: generationKey(workspaceId) }),
  });
}
