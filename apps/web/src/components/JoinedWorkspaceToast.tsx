"use client";

import { Suspense, useEffect, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useLingui } from "@lingui/react";
import { Trans } from "@lingui/react/macro";
import { msg } from "@lingui/core/macro";

// Reuses the shared `.em-toast` styling. Reads the one-shot `joined_workspace`
// query param the invite-accept redirect sets, then strips it from the URL so a
// refresh does not re-show the toast.
function JoinedWorkspaceToastInner() {
  const { _ } = useLingui();
  const searchParams = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const name = searchParams.get("joined_workspace");
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (!name) return;
    setVisible(true);
    const params = new URLSearchParams(searchParams);
    params.delete("joined_workspace");
    const query = params.toString();
    router.replace(query ? `${pathname}?${query}` : pathname);
    const timer = setTimeout(() => setVisible(false), 6000);
    return () => clearTimeout(timer);
    // Keyed on `name` only: once the param is stripped the effect re-runs with
    // name=null and returns early. router/pathname/searchParams are stable refs.
  }, [name]);

  if (!visible || !name) return null;

  return (
    <div className="em-toast-host">
      <div className="em-toast" role="status">
        <span className="t-dot" />
        <span>
          <Trans>Joined {name}</Trans>
        </span>
        <button
          type="button"
          className="em-toast-close"
          onClick={() => setVisible(false)}
          aria-label={_( msg`Dismiss`)}
        >
          ×
        </button>
      </div>
    </div>
  );
}

export function JoinedWorkspaceToast() {
  return (
    <Suspense>
      <JoinedWorkspaceToastInner />
    </Suspense>
  );
}
