"use client";

import { Trans } from "@lingui/react/macro";
import { useLingui } from "@lingui/react";
import { msg } from "@lingui/core/macro";
import { bridgeSignInAction } from "@/actions/bridge";
import { AuthShell } from "@/components/AuthShell";

/**
 * Shown when the browser is already signed in as somebody else. Switching
 * accounts silently would be the wrong default on a shared or multi-account
 * browser, so the choice is explicit: continue as the extension's account, or
 * keep the current one and go on to the page anyway.
 */
export function BridgeAccountChoice({
  code,
  next,
  incomingEmail,
  currentEmail,
}: {
  code: string;
  next: string;
  incomingEmail: string;
  currentEmail: string | null;
}) {
  const { _ } = useLingui();

  return (
    <AuthShell
      title={_(msg`Switch account?`)}
      subtitle={_(msg`Your extension is signed in to a different account`)}
    >
      <p className="auth-hint">
        {currentEmail ? (
          <Trans>
            This browser is signed in as {currentEmail}, but your extension is signed in as{" "}
            {incomingEmail}.
          </Trans>
        ) : (
          <Trans>Your extension is signed in as {incomingEmail}.</Trans>
        )}
      </p>

      <form action={bridgeSignInAction} className="auth-form">
        <input type="hidden" name="code" value={code} />
        <input type="hidden" name="next" value={next} />
        <button type="submit" className="btn-primary auth-submit">
          <Trans>Continue as {incomingEmail}</Trans>
        </button>
      </form>

      <a href={next} className="auth-link">
        <Trans>Stay signed in with the current account</Trans>
      </a>
    </AuthShell>
  );
}
