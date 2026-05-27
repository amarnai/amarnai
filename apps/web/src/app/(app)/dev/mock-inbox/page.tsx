import { redirect } from "next/navigation";
import { requireUser, getOrCreateDefaultWorkspace } from "@/lib/session";
import { api, type EmailThreadSummary } from "@/lib/api";
import { MockInboxClient } from "./MockInboxClient";

export default async function MockInboxPage() {
  const isDevEnabled =
    process.env["NODE_ENV"] === "development" ||
    process.env["ENABLE_DEV_TOOLS"] === "true";

  if (!isDevEnabled) {
    redirect("/dashboard");
  }

  const user = await requireUser();
  const workspace = await getOrCreateDefaultWorkspace(user.id);

  let threads: EmailThreadSummary[] = [];
  let error: string | null = null;

  try {
    threads = (await api.emailThreads(workspace.id)).threads;
  } catch (err) {
    error = err instanceof Error ? err.message : String(err);
  }

  if (error) {
    return (
      <>
        <h1>Mock Inbox</h1>
        <div className="error-box">{error}</div>
      </>
    );
  }

  return (
    <>
      <h1>Mock Inbox</h1>
      <p style={{ color: "var(--color-muted)", marginBottom: 24, fontSize: 13 }}>
        Dev tool — simulate incoming email events without Gmail OAuth or real AI calls.
      </p>
      <MockInboxClient workspaceId={workspace.id} threads={threads} />
    </>
  );
}
