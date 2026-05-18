import { redirect } from "next/navigation";
import { api, type EmailThreadSummary } from "@/lib/api";
import { MockInboxClient } from "./MockInboxClient";

export default async function MockInboxPage() {
  const isDevEnabled =
    process.env["NODE_ENV"] === "development" ||
    process.env["ENABLE_DEV_TOOLS"] === "true";

  if (!isDevEnabled) {
    redirect("/dashboard");
  }

  let workspaceId: string | null = null;
  let threads: EmailThreadSummary[] = [];
  let error: string | null = null;

  try {
    const workspaces = await api.workspaces();
    const ws = workspaces[0];
    if (!ws) throw new Error("No workspace found");
    workspaceId = ws.id;
    threads = await api.emailThreads(ws.id);
  } catch (err) {
    error = err instanceof Error ? err.message : String(err);
  }

  if (!workspaceId || error) {
    return (
      <>
        <h1>Mock Inbox</h1>
        <div className="error-box">{error ?? "No workspace found"}</div>
      </>
    );
  }

  return (
    <>
      <h1>Mock Inbox</h1>
      <p style={{ color: "#6b7280", marginBottom: 24, fontSize: 13 }}>
        Dev tool — simulate incoming email events without Gmail OAuth or real AI calls.
      </p>
      <MockInboxClient workspaceId={workspaceId} threads={threads} />
    </>
  );
}
