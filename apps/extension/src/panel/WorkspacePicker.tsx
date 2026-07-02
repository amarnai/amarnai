import { Trans } from "@lingui/react/macro";
import { useLingui } from "@lingui/react";
import { msg } from "@lingui/core/macro";
import { useSession } from "../auth/session";

// Slim panel header: workspace switcher + sign out. At 320px there is no room
// for a full switcher UI, so a native <select> is used when the user belongs to
// more than one workspace.
export function PanelHeader() {
  const { _ } = useLingui();
  const { workspaces, workspaceId, switchWorkspace, signOut } = useSession();
  const active = workspaces.find((w) => w.id === workspaceId);

  return (
    <header className="ax-header">
      {workspaces.length > 1 ? (
        <select
          className="ax-ws-select"
          value={workspaceId ?? ""}
          onChange={(e) => switchWorkspace(e.target.value)}
          aria-label={_(msg`Workspace`)}
        >
          {workspaces.map((w) => (
            <option key={w.id} value={w.id}>
              {w.name}
            </option>
          ))}
        </select>
      ) : (
        <span className="ax-ws-name">{active?.name ?? "Amarnai"}</span>
      )}

      <button type="button" className="ax-header-signout" onClick={() => void signOut()}>
        <Trans>Sign out</Trans>
      </button>
    </header>
  );
}
