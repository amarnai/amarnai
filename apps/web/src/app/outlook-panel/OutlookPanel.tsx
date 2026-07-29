"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Trans } from "@lingui/react/macro";
import { useLingui } from "@lingui/react";
import { msg } from "@lingui/core/macro";
import { InjectedThreadPanel } from "@amarnai/panel";
import "@amarnai/ui/emails/styles";
import "@amarnai/panel/styles";
import { paneTokenStore } from "@/lib/outlook/paneTokenStore";
import { whenOfficeReady, type OfficeLike } from "@/lib/outlook/officeHost";
import { createOutlookPanelHost } from "@/lib/outlook/panelHost";
import "./outlook-panel.css";

const API_BASE_URL = (process.env["NEXT_PUBLIC_API_URL"] ?? "http://localhost:3001").replace(
  /\/+$/,
  "",
);

type Stage =
  | { kind: "loading" }
  | { kind: "outsideOutlook" }
  | { kind: "signedOut" }
  | { kind: "ready"; office: OfficeLike };

/**
 * The Amarnai task pane.
 *
 * Everything of substance is @amarnai/panel, the same component Gmail's sidebar
 * renders — so an Outlook user and a Gmail user see the same panel, with the
 * same states, and neither provider can quietly fall behind the other. What is
 * Outlook-specific and lives here: waiting for Office.js, the pane's own
 * password sign-in (it cannot use the web app's cookie session — inside Outlook
 * this is a third-party frame), and the ribbon's ?focus=draft deep link.
 *
 * The pane still never sends. Its one mailbox write is `displayReplyForm`, which
 * opens Outlook's own compose for the user to review and send themselves.
 */
export function OutlookPanel({ autoStart }: { autoStart: boolean }) {
  const [stage, setStage] = useState<Stage>({ kind: "loading" });
  // Bumped by the sign-in form so the panel re-reads the token store, which is
  // the only signal it has that a session appeared.
  const [sessionKey, setSessionKey] = useState(0);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      let office: OfficeLike;
      try {
        office = await whenOfficeReady();
      } catch {
        // Someone opened the pane URL directly in a browser. Say so, rather
        // than spinning forever on an Office that will never initialise.
        if (!cancelled) setStage({ kind: "outsideOutlook" });
        return;
      }
      if (cancelled) return;
      setStage(
        (await paneTokenStore.get()) ? { kind: "ready", office } : { kind: "signedOut" },
      );
    })();
    return () => {
      cancelled = true;
    };
  }, [sessionKey]);

  const handleRequestSignIn = useCallback(() => setStage({ kind: "signedOut" }), []);

  const office = stage.kind === "ready" ? stage.office : null;
  const host = useMemo(
    () =>
      office
        ? createOutlookPanelHost({
            office,
            apiBaseUrl: API_BASE_URL,
            onRequestSignIn: handleRequestSignIn,
          })
        : null,
    [office, handleRequestSignIn],
  );

  if (stage.kind === "loading") {
    return (
      <main className="outlook-pane">
        <p className="outlook-pane-status">
          <Trans>Loading…</Trans>
        </p>
      </main>
    );
  }

  if (stage.kind === "outsideOutlook") {
    return (
      <main className="outlook-pane">
        <p className="outlook-pane-status">
          <Trans>Open this from the Amarnai button in Outlook.</Trans>
        </p>
      </main>
    );
  }

  if (stage.kind === "signedOut" || !host) {
    return (
      <main className="outlook-pane">
        <SignInForm onSignedIn={() => setSessionKey((k) => k + 1)} />
      </main>
    );
  }

  return (
    <main className="outlook-pane outlook-pane--panel">
      {/* The pane is served BY the web app, so its own origin is the web app's
          — no env var needed. Unused in practice: this host reports
          openExternal:false, because Outlook desktop is a WebView with nowhere
          useful for window.open to land. */}
      <InjectedThreadPanel
        host={host}
        webAppUrl={window.location.origin}
        autoDraft={autoStart}
      />
      <p className="outlook-pane-footnote">
        <Trans>Amarnai never sends email. You review and send from Outlook.</Trans>
      </p>
    </main>
  );
}

/**
 * Email + password only. The pane cannot use the web app's cookie session (it is
 * a third-party frame here), and an OAuth popup inside Outlook's desktop WebView2
 * is unreliable — so this is the path that works everywhere. Google-account users
 * sign in on the web app and set a password there.
 */
function SignInForm({ onSignedIn }: { onSignedIn: () => void }) {
  const { _ } = useLingui();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | undefined>(undefined);
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setPending(true);
    setError(undefined);
    try {
      const res = await fetch(`${API_BASE_URL}/auth/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      });
      if (!res.ok) {
        setError(
          res.status === 401
            ? _(msg`Incorrect email or password.`)
            : _(msg`Could not sign in. Please try again.`),
        );
        return;
      }
      await paneTokenStore.set(await res.json());
      onSignedIn();
    } catch {
      setError(_(msg`Could not reach Amarnai. Check your connection.`));
    } finally {
      setPending(false);
    }
  }

  return (
    <form className="outlook-pane-form" onSubmit={(e) => void submit(e)}>
      <p className="outlook-pane-status">
        <Trans>Sign in to your Amarnai account.</Trans>
      </p>
      <label className="outlook-pane-label">
        <Trans>Email</Trans>
        <input
          type="email"
          autoComplete="username"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />
      </label>
      <label className="outlook-pane-label">
        <Trans>Password</Trans>
        <input
          type="password"
          autoComplete="current-password"
          required
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
      </label>
      {error && <p className="outlook-pane-status outlook-pane-warn">{error}</p>}
      <button type="submit" className="outlook-pane-button" disabled={pending}>
        {pending ? _(msg`Signing in…`) : _(msg`Sign in`)}
      </button>
    </form>
  );
}
