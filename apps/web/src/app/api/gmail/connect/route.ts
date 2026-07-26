import { NextRequest, NextResponse } from "next/server";
import { requireUser, assertWorkspaceOwner } from "@/lib/session";
import { generateState, buildGmailAuthUrl } from "@/lib/gmail-oauth";

export async function GET(req: NextRequest) {
  const workspaceId = req.nextUrl.searchParams.get("workspaceId");
  if (!workspaceId) {
    return NextResponse.json({ error: "Missing workspaceId" }, { status: 400 });
  }

  // `intent=writeback` upgrades an existing connection with the gmail.modify
  // scope (incremental consent) instead of connecting a fresh mailbox.
  const isWriteback = req.nextUrl.searchParams.get("intent") === "writeback";

  // Let redirect() from requireUser/assertWorkspaceOwner propagate naturally.
  const user = await requireUser();
  await assertWorkspaceOwner(workspaceId, user.id);

  const state = generateState(workspaceId, user.id, isWriteback ? "writeback" : "connect");
  return NextResponse.redirect(buildGmailAuthUrl(state, { writeback: isWriteback }));
}
