import { useEffect, useState, type ReactNode } from "react";
import { Trans } from "@lingui/react/macro";
import { ensureHostPermissions, hasHostPermissions } from "./permissions";

// Guards signed-in content behind the host permissions. On Chrome they are
// granted at install, so `contains()` is true and this renders children straight
// away. On Firefox a session restored from stored tokens (or a temporary load, or
// a user who revoked access in about:addons) can be signed in WITHOUT the grant,
// which would silently CORS-block every fetch; this shows a one-tap re-grant
// instead of a broken panel.
export function HostPermissionGate({ children }: { children: ReactNode }) {
  // Optimistic: render children immediately (Chrome always has the grant, so it
  // is never flashed a spinner or notice), and only swap to the re-grant notice
  // if the async check comes back false — the ungranted Firefox case.
  const [granted, setGranted] = useState(true);

  useEffect(() => {
    let cancelled = false;
    void hasHostPermissions().then((ok) => {
      if (!cancelled) setGranted(ok);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  async function onGrant() {
    if (await ensureHostPermissions()) setGranted(true);
  }

  if (!granted) {
    return (
      <div className="ax-center ax-muted ax-noworkspace">
        <p><Trans>Amarnai needs access to its server and Gmail to show your inbox.</Trans></p>
        <button type="button" className="ax-btn ax-btn-primary" onClick={() => void onGrant()}>
          <Trans>Grant access</Trans>
        </button>
      </div>
    );
  }

  return <>{children}</>;
}
