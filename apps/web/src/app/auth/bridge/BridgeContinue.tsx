"use client";

import { useEffect, useRef } from "react";
import { Trans } from "@lingui/react/macro";
import { bridgeSignInAction } from "@/actions/bridge";
import { AuthShell } from "@/components/AuthShell";
import { useLingui } from "@lingui/react";
import { msg } from "@lingui/core/macro";

/**
 * Completes the handoff from the extension. Submits itself on mount so the
 * common path costs zero clicks: the user clicked a link in the side panel and
 * should land on the page they asked for, not on a confirmation step.
 *
 * The visible button is the no-script fallback and the retry surface if the
 * automatic submit is blocked.
 */
export function BridgeContinue({ code, next }: { code: string; next: string }) {
  const { _ } = useLingui();
  const formRef = useRef<HTMLFormElement>(null);
  const submitted = useRef(false);

  useEffect(() => {
    if (submitted.current) return;
    submitted.current = true;
    formRef.current?.requestSubmit();
  }, []);

  return (
    <AuthShell title={_(msg`Signing you in`)} subtitle={_(msg`Continuing from your browser extension`)}>
      <form ref={formRef} action={bridgeSignInAction} className="auth-form">
        <input type="hidden" name="code" value={code} />
        <input type="hidden" name="next" value={next} />
        <button type="submit" className="btn-primary auth-submit">
          <Trans>Continue</Trans>
        </button>
      </form>
    </AuthShell>
  );
}
