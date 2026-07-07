import { NextRequest, NextResponse } from "next/server";
import { requireUser, assertWorkspaceOwner } from "@/lib/session";
import { generateState } from "@/lib/gmail-oauth";
import { buildOutlookAuthUrl } from "@/lib/outlook-oauth";

export async function GET(req: NextRequest) {
  const workspaceId = req.nextUrl.searchParams.get("workspaceId");
  if (!workspaceId) {
    return NextResponse.json({ error: "Missing workspaceId" }, { status: 400 });
  }

  // Let redirect() from requireUser/assertWorkspaceOwner propagate naturally.
  const user = await requireUser();
  await assertWorkspaceOwner(workspaceId, user.id);

  // State signing is provider-neutral, so the Gmail generator is reused.
  const state = generateState(workspaceId, user.id);
  return NextResponse.redirect(buildOutlookAuthUrl(state));
}
