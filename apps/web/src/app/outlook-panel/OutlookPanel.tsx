"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Trans } from "@lingui/react/macro";
import { useLingui } from "@lingui/react";
import { msg } from "@lingui/core/macro";
import { makeApiClient, makeBearerTransport, type ApiClient } from "@amarnai/api-client";
import { paneTokenStore } from "@/lib/outlook/paneTokenStore";
import { whenOfficeReady, readOutlookContext, type OutlookContext } from "@/lib/outlook/officeHost";
import { generateAndInsertReply, type PaneOutcome } from "@/lib/outlook/paneFlow";
import "./outlook-panel.css";

const API_BASE_URL = (process.env["NEXT_PUBLIC_API_URL"] ?? "http://localhost:3001").replace(
  /\/+$/,
  "",
);

type Stage =
  | { kind: "loading" }
  | { kind: "outsideOutlook" }
  | { kind: "signedOut"; error?: string }
  | { kind: "noMessage" }
  | { kind: "ready" }
  | { kind: "working" }
  | { kind: "done"; outcome: PaneOutcome };

/**
 * The Amarnai Reply task pane.
 *
 * Deliberately one job: draft a reply to the open conversation and hand it to
 * Outlook's own reply form. It never sends, and it holds no mail state of its
 * own — the ribbon button opens it, it does the thing, Outlook takes over.
 */
export function OutlookPanel({ autoStart }: { autoStart: boolean }) {
  const { _ } = useLingui();
  const [stage, setStage] = useState<Stage>({ kind: "loading" });
  const [context, setContext] = useState<OutlookContext | null>(null);
  const officeRef = useRef<Awaited<ReturnType<typeof whenOfficeReady>> | null>(null);
  // A deep link must generate once, not again on every re-render.
  const autoStarted = useRef(false);

  const api: ApiClient = useMemo(
    () =>
      makeApiClient(
        makeBearerTransport({
          baseUrl: API_BASE_URL,
          tokenStore: paneTokenStore,
          onAuthFailure: () => setStage({ kind: "signedOut" }),
        }),
      ),
    [],
  );

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      let office;
      try {
        office = await whenOfficeReady();
      } catch {
        if (!cancelled) setStage({ kind: "outsideOutlook" });
        return;
      }
      if (cancelled) return;
      officeRef.current = office;

      const ctx = readOutlookContext(office);
      if (!ctx) {
        setStage({ kind: "noMessage" });
        return;
      }
      setContext(ctx);
      setStage((await paneTokenStore.get()) ? { kind: "ready" } : { kind: "signedOut" });
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const run = useCallback(async () => {
    const office = officeRef.current;
    if (!office || !context) return;
    setStage({ kind: "working" });
    const outcome = await generateAndInsertReply(api, office, context);
    setStage({ kind: "done", outcome });
  }, [api, context]);

  // Deep link from the ribbon: the user already expressed intent by clicking it,
  // so do not make them click a second button in the pane.
  useEffect(() => {
    if (!autoStart || autoStarted.current) return;
    if (stage.kind !== "ready") return;
    autoStarted.current = true;
    void run();
  }, [autoStart, stage.kind, run]);

  return (
    <main className="outlook-pane">
      <h1 className="outlook-pane-title">
        <Trans>Amarnai Reply</Trans>
      </h1>

      {stage.kind === "loading" && (
        <p className="outlook-pane-status">
          <Trans>Loading…</Trans>
        </p>
      )}

      {stage.kind === "outsideOutlook" && (
        <p className="outlook-pane-status">
          <Trans>Open this from the Amarnai Reply button in Outlook.</Trans>
        </p>
      )}

      {stage.kind === "noMessage" && (
        <p className="outlook-pane-status">
          <Trans>Open a message first, then choose Amarnai Reply.</Trans>
        </p>
      )}

      {stage.kind === "signedOut" && (
        <SignInForm
          initialError={stage.error}
          onSignedIn={() => setStage({ kind: "ready" })}
        />
      )}

      {stage.kind === "ready" && (
        <>
          <p className="outlook-pane-status">
            <Trans>Amarnai will draft a reply and open it in Outlook for you to review.</Trans>
          </p>
          <button type="button" className="outlook-pane-button" onClick={() => void run()}>
            <Trans>Draft a reply</Trans>
          </button>
        </>
      )}

      {stage.kind === "working" && (
        <p className="outlook-pane-status" aria-live="polite">
          <Trans>Drafting…</Trans>
        </p>
      )}

      {stage.kind === "done" && (
        <>
          <Outcome outcome={stage.outcome} />
          {stage.outcome.kind !== "injectionDisabled" && (
            <button type="button" className="outlook-pane-button" onClick={() => void run()}>
              {stage.outcome.kind === "inserted"
                ? _( msg`Draft another`)
                : _( msg`Try again`)}
            </button>
          )}
        </>
      )}

      <p className="outlook-pane-footnote">
        <Trans>Amarnai never sends email. You review and send from Outlook.</Trans>
      </p>
    </main>
  );
}

function Outcome({ outcome }: { outcome: PaneOutcome }) {
  switch (outcome.kind) {
    case "inserted":
      return (
        <p className="outlook-pane-status" aria-live="polite">
          <Trans>Draft ready in your reply. Review it, then send when you are happy.</Trans>
        </p>
      );
    case "quota":
      return (
        <p className="outlook-pane-status outlook-pane-warn" aria-live="polite">
          <Trans>
            You have used all {outcome.limit} drafts in your plan this month. They reset on{" "}
            {new Date(outcome.resetsAt).toLocaleDateString()}.
          </Trans>
        </p>
      );
    case "notSorted":
      return (
        <p className="outlook-pane-status outlook-pane-warn" aria-live="polite">
          <Trans>Amarnai has not sorted this thread yet. Try again in a moment.</Trans>
        </p>
      );
    case "noThread":
      return (
        <p className="outlook-pane-status outlook-pane-warn" aria-live="polite">
          <Trans>This conversation has not synced to Amarnai yet.</Trans>
        </p>
      );
    case "noWorkspace":
      return (
        <p className="outlook-pane-status outlook-pane-warn" aria-live="polite">
          <Trans>This mailbox is not connected to any of your Amarnai workspaces.</Trans>
        </p>
      );
    case "injectionDisabled":
      return (
        <p className="outlook-pane-status outlook-pane-warn" aria-live="polite">
          <Trans>The Amarnai Reply button is switched off for this workspace in settings.</Trans>
        </p>
      );
    default:
      return (
        <p className="outlook-pane-status outlook-pane-warn" aria-live="polite">
          <Trans>Something went wrong. Please try again.</Trans>
        </p>
      );
  }
}

/**
 * Email + password only. The pane cannot use the web app's cookie session (it is
 * a third-party frame here), and an OAuth popup inside Outlook's desktop WebView2
 * is unreliable — so this is the path that works everywhere. Google-account users
 * sign in on the web app and set a password there.
 */
function SignInForm({
  initialError,
  onSignedIn,
}: {
  initialError: string | undefined;
  onSignedIn: () => void;
}) {
  const { _ } = useLingui();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | undefined>(initialError);

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
            ? _( msg`Incorrect email or password.`)
            : _( msg`Could not sign in. Please try again.`),
        );
        return;
      }
      await paneTokenStore.set(await res.json());
      onSignedIn();
    } catch {
      setError(_( msg`Could not reach Amarnai. Check your connection.`));
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
        {pending ? _( msg`Signing in…`) : _( msg`Sign in`)}
      </button>
    </form>
  );
}
