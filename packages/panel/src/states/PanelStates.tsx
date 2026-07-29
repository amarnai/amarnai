"use client";

import { Trans } from "@lingui/react/macro";
import type { MailAccount } from "@amarnai/api-client";

// The screens for every way the mail client can be in a state Amarnai cannot act
// on. They share a shape deliberately: one sentence saying what is true, and at
// most one action. A panel wedged into someone else's UI that starts explaining
// itself at length is worse than one that says nothing.

export function PanelMessage({
  children,
  action,
}: {
  children: React.ReactNode;
  action?: React.ReactNode;
}) {
  return (
    <div className="apn-state">
      <p className="apn-state-text">{children}</p>
      {action}
    </div>
  );
}

export function PanelActionButton({
  onClick,
  children,
}: {
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button type="button" className="apn-btn apn-btn-primary" onClick={onClick}>
      {children}
    </button>
  );
}

export function SignedOutState({ onSignIn }: { onSignIn: (() => void) | null }) {
  return (
    <PanelMessage
      action={
        onSignIn ? (
          <PanelActionButton onClick={onSignIn}>
            <Trans>Sign in</Trans>
          </PanelActionButton>
        ) : undefined
      }
    >
      <Trans>Sign in to Amarnai to see how this thread was sorted.</Trans>
    </PanelMessage>
  );
}

export function NotConnectedState({ onOpenApp }: { onOpenApp: (() => void) | null }) {
  return (
    <PanelMessage
      action={
        onOpenApp ? (
          <PanelActionButton onClick={onOpenApp}>
            <Trans>Connect a mailbox</Trans>
          </PanelActionButton>
        ) : undefined
      }
    >
      <Trans>Connect a mailbox to Amarnai to start sorting your inbox.</Trans>
    </PanelMessage>
  );
}

/**
 * The ordinary multi-login case: a second Gmail account in the same browser, or
 * a shared mailbox. Naming the connected address is the whole point — it turns
 * "Amarnai is broken here" into "you are in the other account".
 */
export function MismatchState({
  accountEmail,
  knownAccounts,
}: {
  accountEmail: string;
  knownAccounts: MailAccount[];
}) {
  const connected = knownAccounts.map((a) => a.email).join(", ");
  return (
    <PanelMessage>
      {knownAccounts.length > 0 ? (
        <Trans>
          {accountEmail} is not connected to Amarnai. You have {connected} connected.
        </Trans>
      ) : (
        <Trans>{accountEmail} is not connected to Amarnai.</Trans>
      )}
    </PanelMessage>
  );
}

/**
 * The mail client is showing no conversation AND the host could not tell which
 * mailbox is on screen — the only case left now that a known mailbox gets the
 * queue instead. Rare (a Gmail layout whose account switcher we cannot read, an
 * Outlook pane with no user profile) and unactionable, so it stays a sentence.
 */
export function NoThreadState() {
  return (
    <PanelMessage>
      <Trans>Open a conversation to see how Amarnai sorted it.</Trans>
    </PanelMessage>
  );
}

export function NotSyncedState({ onRetry }: { onRetry: () => void }) {
  return (
    <PanelMessage
      action={
        <PanelActionButton onClick={onRetry}>
          <Trans>Check again</Trans>
        </PanelActionButton>
      }
    >
      <Trans>Amarnai hasn't synced this conversation yet.</Trans>
    </PanelMessage>
  );
}

/**
 * The workspace switched the panel off. No retry: it is a refusal, not a
 * failure, and offering to try again would be a lie.
 */
export function InjectionDisabledState() {
  return (
    <PanelMessage>
      <Trans>The Amarnai panel is switched off for this workspace.</Trans>
    </PanelMessage>
  );
}

export function ErrorState({ onRetry }: { onRetry: () => void }) {
  return (
    <PanelMessage
      action={
        <PanelActionButton onClick={onRetry}>
          <Trans>Try again</Trans>
        </PanelActionButton>
      }
    >
      <Trans>Could not reach Amarnai.</Trans>
    </PanelMessage>
  );
}

export function LoadingState() {
  return (
    <div className="apn-state" aria-live="polite">
      <span className="apn-skeleton-pulse" aria-hidden />
      <p className="apn-state-text">
        <Trans>Loading…</Trans>
      </p>
    </div>
  );
}

/**
 * The sort was deferred because the inbox is out of monthly allowance. Shown as
 * an overlay above the thread rather than instead of it: the thread is still
 * worth reading, it just has not been filed.
 */
export function QuotaUpsell({ onUpgrade }: { onUpgrade: (() => void) | null }) {
  return (
    <div className="apn-quota">
      <p className="apn-state-text">
        <Trans>You've used all your sorting for this month, so this thread is waiting.</Trans>
      </p>
      {onUpgrade && (
        <button type="button" className="apn-btn apn-btn-primary" onClick={onUpgrade}>
          <Trans>Upgrade</Trans>
        </button>
      )}
    </div>
  );
}
