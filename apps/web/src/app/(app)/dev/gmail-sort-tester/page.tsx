import { redirect } from "next/navigation";
import { requireUser } from "@/lib/session";
import { getSelectedWorkspace } from "@/lib/workspace";
import { api } from "@/lib/api";
import { GmailDebugPanel } from "./GmailDebugPanel";

export default async function GmailSortTesterPage() {
  if (process.env["NEXT_PUBLIC_ENABLE_GMAIL_DEBUG_TOOLS"] !== "true") {
    redirect("/dashboard");
  }

  const user = await requireUser();
  const workspace = await getSelectedWorkspace(user.id);

  let connection = null;
  try {
    connection = await api.gmailConnection(workspace.id);
  } catch {
    // API unavailable
  }

  return (
    <>
      <h1>
        Gmail Sort Tester{" "}
        <span
          style={{
            fontSize: 11,
            fontWeight: 500,
            padding: "2px 6px",
            borderRadius: 4,
            background: "var(--color-warning-subtle, #fef3c7)",
            color: "var(--color-warning, #92400e)",
            verticalAlign: "middle",
          }}
        >
          DEV ONLY
        </span>
      </h1>
      <p style={{ color: "var(--color-muted)", marginBottom: 24, fontSize: 13 }}>
        Fetch a real Gmail thread by ID, run the sorting pipeline, and inspect the result.
        Results are persisted. Body text is never stored.
      </p>
      {connection ? (
        <GmailDebugPanel workspaceId={workspace.id} />
      ) : (
        <div className="warning-box">
          No Gmail inbox connected. Connect one in <a href="/settings">Settings</a> first.
        </div>
      )}
    </>
  );
}
