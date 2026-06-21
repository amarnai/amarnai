import { NextResponse } from "next/server";
import { resolveBillingUser, resolveBillingWorkspaceId } from "@/lib/billing-auth";
import { assembleBillingState } from "@/lib/billing-state";

/**
 * Billing display state for a workspace. Native mobile clients call this with a
 * Bearer JWT + explicit `workspaceId`; web uses its cookie session + selection.
 */
export async function GET(request: Request) {
  const authResult = await resolveBillingUser(request);
  if (!authResult.ok) {
    return NextResponse.json({ error: authResult.error }, { status: authResult.status });
  }
  const { userId } = authResult;

  const url = new URL(request.url);
  const requestedWorkspaceId = url.searchParams.get("workspaceId") ?? undefined;
  const workspaceId = await resolveBillingWorkspaceId(userId, requestedWorkspaceId);
  if (!workspaceId) {
    return NextResponse.json({ error: "Workspace not found" }, { status: 404 });
  }

  // Reconcile with Stripe so state is fresh after returning from checkout/portal.
  const state = await assembleBillingState(userId, workspaceId, { forceReconcile: true });
  return NextResponse.json(state);
}
