"use server";

import { requireUser, assertTaxonomyEditor } from "@/lib/session";
import type {
  TaxonomyNode,
  TaxonomyEdge,
  CreateTaxonomyNodeInput,
  UpdateTaxonomyNodeInput,
  CreateTaxonomyEdgeInput,
  UpdateTaxonomyEdgeInput,
} from "@/lib/api";
import type { TaxonomyTransferFile } from "@amarnai/shared";
import type { TaxonomyGenerationStatusResult } from "@amarnai/api-client";

const API_BASE = process.env["API_URL"] ?? "http://localhost:3001";
const INTERNAL_SECRET = process.env["INTERNAL_API_SECRET"] ?? "dev-internal-secret";

function authHeaders(userId: string): Record<string, string> {
  return {
    "Content-Type": "application/json",
    "X-User-Id": userId,
    ...(INTERNAL_SECRET ? { Authorization: `Bearer ${INTERNAL_SECRET}` } : {}),
  };
}

async function apiCall<T>(
  path: string,
  method: "POST" | "PATCH" | "DELETE",
  userId: string,
  body?: unknown
): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    method,
    headers: {
      "Content-Type": "application/json",
      "X-User-Id": userId,
      ...(INTERNAL_SECRET ? { Authorization: `Bearer ${INTERNAL_SECRET}` } : {}),
    },
    body: body !== undefined ? JSON.stringify(body) : null,
    cache: "no-store",
  });
  if (!res.ok) {
    const err = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(err.error ?? `API error ${res.status}`);
  }
  return res.json() as Promise<T>;
}

export async function createTaxonomyNodeAction(
  workspaceId: string,
  data: CreateTaxonomyNodeInput
): Promise<TaxonomyNode> {
  const user = await requireUser();
  await assertTaxonomyEditor(workspaceId, user.id);
  return apiCall<TaxonomyNode>(
    `/workspaces/${workspaceId}/taxonomy-nodes`,
    "POST",
    user.id,
    data
  );
}

export async function updateTaxonomyNodeAction(
  workspaceId: string,
  nodeId: string,
  data: UpdateTaxonomyNodeInput
): Promise<TaxonomyNode> {
  const user = await requireUser();
  await assertTaxonomyEditor(workspaceId, user.id);
  return apiCall<TaxonomyNode>(
    `/workspaces/${workspaceId}/taxonomy-nodes/${nodeId}`,
    "PATCH",
    user.id,
    data
  );
}

export async function deleteTaxonomyNodeAction(
  workspaceId: string,
  nodeId: string,
  moveToNodeId?: string
): Promise<{ ok: boolean }> {
  const user = await requireUser();
  await assertTaxonomyEditor(workspaceId, user.id);
  return apiCall<{ ok: boolean }>(
    `/workspaces/${workspaceId}/taxonomy-nodes/${nodeId}`,
    "DELETE",
    user.id,
    moveToNodeId ? { moveToNodeId } : undefined
  );
}

export async function createTaxonomyEdgeAction(
  workspaceId: string,
  data: CreateTaxonomyEdgeInput
): Promise<TaxonomyEdge> {
  const user = await requireUser();
  await assertTaxonomyEditor(workspaceId, user.id);
  return apiCall<TaxonomyEdge>(
    `/workspaces/${workspaceId}/taxonomy-edges`,
    "POST",
    user.id,
    data
  );
}

export async function updateTaxonomyEdgeAction(
  workspaceId: string,
  edgeId: string,
  data: UpdateTaxonomyEdgeInput
): Promise<TaxonomyEdge> {
  const user = await requireUser();
  await assertTaxonomyEditor(workspaceId, user.id);
  return apiCall<TaxonomyEdge>(
    `/workspaces/${workspaceId}/taxonomy-edges/${edgeId}`,
    "PATCH",
    user.id,
    data
  );
}

export async function deleteTaxonomyEdgeAction(
  workspaceId: string,
  edgeId: string
): Promise<{ ok: boolean }> {
  const user = await requireUser();
  await assertTaxonomyEditor(workspaceId, user.id);
  return apiCall<{ ok: boolean }>(
    `/workspaces/${workspaceId}/taxonomy-edges/${edgeId}`,
    "DELETE",
    user.id
  );
}

export async function importTaxonomyAction(
  workspaceId: string,
  file: TaxonomyTransferFile
): Promise<{ ok: boolean; nodeCount: number; edgeCount: number }> {
  const user = await requireUser();
  await assertTaxonomyEditor(workspaceId, user.id);
  return apiCall<{ ok: boolean; nodeCount: number; edgeCount: number }>(
    `/workspaces/${workspaceId}/taxonomy-import`,
    "POST",
    user.id,
    file
  );
}

// ─── Auto-generate taxonomy from inbox ──────────────────────────────────────────

export type GenerateTaxonomyActionResult =
  | { ok: true }
  | { ok: false; reason: string; nextEligibleAt?: string };

/**
 * Request a taxonomy generation. Returns ok on enqueue; on a limiter denial
 * (429) or an already-running job (409) returns ok:false with the reason so the
 * UI can explain it rather than throwing.
 */
export async function generateTaxonomyAction(
  workspaceId: string
): Promise<GenerateTaxonomyActionResult> {
  const user = await requireUser();
  await assertTaxonomyEditor(workspaceId, user.id);
  const res = await fetch(`${API_BASE}/workspaces/${workspaceId}/taxonomy-generate`, {
    method: "POST",
    headers: authHeaders(user.id),
    cache: "no-store",
  });
  if (res.ok) return { ok: true };
  const body = (await res.json().catch(() => ({}))) as {
    error?: string;
    reason?: string;
    nextEligibleAt?: string;
  };
  if (res.status === 409) return { ok: false, reason: "RUNNING" };
  if (res.status === 429) {
    return {
      ok: false,
      reason: body.reason ?? "NOT_ELIGIBLE",
      ...(body.nextEligibleAt ? { nextEligibleAt: body.nextEligibleAt } : {}),
    };
  }
  throw new Error(body.error ?? `API error ${res.status}`);
}

/** Poll current generation status, eligibility, and the READY proposal. */
export async function getTaxonomyGenerationAction(
  workspaceId: string
): Promise<TaxonomyGenerationStatusResult> {
  const user = await requireUser();
  const res = await fetch(`${API_BASE}/workspaces/${workspaceId}/taxonomy-generate`, {
    method: "GET",
    headers: authHeaders(user.id),
    cache: "no-store",
  });
  if (!res.ok) {
    const err = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(err.error ?? `API error ${res.status}`);
  }
  return res.json() as Promise<TaxonomyGenerationStatusResult>;
}
