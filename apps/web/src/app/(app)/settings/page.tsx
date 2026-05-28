import { requireUser } from "@/lib/session";
import { getSelectedWorkspace } from "@/lib/workspace";
import { api } from "@/lib/api";
import { GmailConnectionSection } from "./GmailConnectionSection";
import { WorkspaceNameSection } from "./WorkspaceNameSection";

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

export default async function SettingsPage({ searchParams }: { searchParams: SearchParams }) {
  const user = await requireUser();
  const workspace = await getSelectedWorkspace(user.id);
  const params = await searchParams;

  const connectError =
    typeof params["gmail_error"] === "string" ? params["gmail_error"] : null;
  const connectSuccess = params["gmail_connected"] === "1";

  let connection = null;
  let syncStatus = null;
  let syncSettings = null;
  try {
    [connection, syncStatus, syncSettings] = await Promise.all([
      api.gmailConnection(workspace.id),
      api.syncStatus(workspace.id),
      api.gmailSyncSettings(workspace.id),
    ]);
  } catch {
    // API unavailable — show disconnected state
  }

  return (
    <>
      <h1>Workspace Settings</h1>
      <WorkspaceNameSection currentName={workspace.name} />
      <GmailConnectionSection
        workspaceId={workspace.id}
        connection={connection}
        syncStatus={syncStatus}
        syncSettings={syncSettings}
        connectError={connectError}
        connectSuccess={connectSuccess}
      />
    </>
  );
}
