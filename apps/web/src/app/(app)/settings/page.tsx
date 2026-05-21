import { requireUser, getOrCreateDefaultWorkspace } from "@/lib/session";
import { api } from "@/lib/api";
import { GmailConnectionSection } from "./GmailConnectionSection";

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

export default async function SettingsPage({ searchParams }: { searchParams: SearchParams }) {
  const user = await requireUser();
  const workspace = await getOrCreateDefaultWorkspace(user.id);
  const params = await searchParams;

  const connectError =
    typeof params["gmail_error"] === "string" ? params["gmail_error"] : null;
  const connectSuccess = params["gmail_connected"] === "1";

  let connection = null;
  try {
    connection = await api.gmailConnection(workspace.id);
  } catch {
    // API unavailable — show disconnected state
  }

  return (
    <>
      <h1>Settings</h1>
      <GmailConnectionSection
        workspaceId={workspace.id}
        connection={connection}
        connectError={connectError}
        connectSuccess={connectSuccess}
      />
    </>
  );
}
