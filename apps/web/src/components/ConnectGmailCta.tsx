"use client";

import { useState } from "react";
import Image from "next/image";
import { Trans } from "@lingui/react/macro";
import { useLingui } from "@lingui/react";
import { msg } from "@lingui/core/macro";
import { GoogleGIcon, OutlookIcon } from "@amarnai/ui";
import type { MailProvider } from "@/lib/api";
import { AziruIntroDialog } from "./AziruIntroDialog";

type Props = {
  workspaceId: string;
  /** True when a disconnected connection already exists, so this is a reconnect. */
  reconnect?: boolean;
  /** Which provider this CTA connects. Defaults to Gmail. */
  provider?: MailProvider;
  /** When set, renders a secondary "connect the other provider instead" link. */
  secondaryProvider?: MailProvider | undefined;
  /**
   * Whether the workspace holds retained synced email that switching to the
   * secondary provider would erase. When true (reconnect only), the secondary
   * action is gated behind a confirmation instead of a plain link.
   */
  hasSyncedData?: boolean;
  /** Address of the retained inbox, shown in the switch-erasure warning. */
  retainedAddress?: string;
};

export function ConnectGmailCta({
  workspaceId,
  reconnect = false,
  provider = "GMAIL",
  secondaryProvider,
  hasSyncedData = false,
  retainedAddress = "",
}: Props) {
  const { _ } = useLingui();
  const [showAziru, setShowAziru] = useState(false);
  const [switchConfirming, setSwitchConfirming] = useState(false);

  const isOutlook = provider === "OUTLOOK";
  // Brand noun interpolated into copy (sanctioned ICU value, not string concat).
  const providerName = isOutlook ? "Outlook" : "Gmail";
  const connectPath = isOutlook ? "outlook" : "gmail";

  // Secondary provider (the one to switch to). On reconnect with retained data,
  // switching erases it, so the action is confirmed rather than a bare link.
  const secondaryName = secondaryProvider === "OUTLOOK" ? "Outlook" : "Gmail";
  const secondaryHref = `/api/${
    secondaryProvider === "OUTLOOK" ? "outlook" : "gmail"
  }/connect?workspaceId=${workspaceId}`;
  const warnOnSwitch = reconnect && hasSyncedData;

  return (
    <div className="connect-gmail-cta-wrap">
      <div className="connect-gmail-cta">
        <button
          type="button"
          className="connect-gmail-cta-mascot"
          onClick={() => setShowAziru(true)}
          aria-label={_(msg`Who is king Aziru?`)}
        >
          <Image
            src="/aziru-safe.png"
            alt="King Aziru"
            width={240}
            height={240}
            priority
            style={{ width: 240, height: "auto" }}
          />
        </button>
        <div className="connect-gmail-cta-body">
          <p className="connect-gmail-cta-title">
            {reconnect ? (
              <Trans>Reconnect your {providerName} inbox</Trans>
            ) : (
              <Trans>Connect your {providerName} inbox</Trans>
            )}
          </p>
          <p className="connect-gmail-cta-description">
            {reconnect ? (
              <Trans>
                Amarnai is no longer syncing this inbox. Reconnect your{" "}
                {providerName} account to resume sorting your email threads. Access
                stays <strong>read-only</strong>, and your inbox stays yours.
              </Trans>
            ) : (
              <Trans>
                <button
                  type="button"
                  className="aziru-easter-egg-link"
                  onClick={() => setShowAziru(true)}
                >
                  King Aziru
                </button>{" "}
                is ready to sort your email threads. Connect your {providerName}{" "}
                account to get started. Amarnai connects with{" "}
                <strong>read-only access</strong> and{" "}
                <strong>never sends, deletes, or changes anything</strong>. Your
                inbox stays yours.
              </Trans>
            )}
          </p>
          <a
            href={`/api/${connectPath}/connect?workspaceId=${workspaceId}`}
            className={`${isOutlook ? "btn-outlook" : "btn-primary"} connect-gmail-cta-btn`}
          >
            {isOutlook ? (
              <OutlookIcon variant="mono" size={16} />
            ) : (
              <GoogleGIcon variant="mono" size={16} />
            )}
            {reconnect ? (
              <Trans>Reconnect {providerName}</Trans>
            ) : (
              <Trans>Connect {providerName}</Trans>
            )}
          </a>
          {secondaryProvider &&
            (warnOnSwitch ? (
              switchConfirming ? (
                <div className="connect-gmail-cta-switch-confirm">
                  <p className="account-danger-warning">
                    <Trans>
                      Connecting {secondaryName} will permanently remove the
                      sorted email saved from {retainedAddress}. Your folders and
                      settings are kept.
                    </Trans>
                  </p>
                  <div className="account-delete-actions">
                    <a href={secondaryHref} className="btn-danger">
                      <Trans>Continue to {secondaryName}</Trans>
                    </a>
                    <button
                      type="button"
                      className="btn-ghost"
                      onClick={() => setSwitchConfirming(false)}
                    >
                      <Trans>Cancel</Trans>
                    </button>
                  </div>
                </div>
              ) : (
                <button
                  type="button"
                  className="connect-gmail-cta-secondary"
                  onClick={() => setSwitchConfirming(true)}
                >
                  <Trans>Connect {secondaryName} instead</Trans>
                </button>
              )
            ) : (
              <a href={secondaryHref} className="connect-gmail-cta-secondary">
                {secondaryProvider === "OUTLOOK" ? (
                  <Trans>Prefer Outlook? Connect Outlook instead</Trans>
                ) : (
                  <Trans>Prefer Gmail? Connect Gmail instead</Trans>
                )}
              </a>
            ))}
        </div>
      </div>
      {showAziru && <AziruIntroDialog onClose={() => setShowAziru(false)} />}
    </div>
  );
}
