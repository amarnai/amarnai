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
};

export function ConnectGmailCta({
  workspaceId,
  reconnect = false,
  provider = "GMAIL",
  secondaryProvider,
}: Props) {
  const { _ } = useLingui();
  const [showAziru, setShowAziru] = useState(false);

  const isOutlook = provider === "OUTLOOK";
  // Brand noun interpolated into copy (sanctioned ICU value, not string concat).
  const providerName = isOutlook ? "Outlook" : "Gmail";
  const connectPath = isOutlook ? "outlook" : "gmail";

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
            className="btn-primary connect-gmail-cta-btn"
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
          {secondaryProvider && (
            <a
              href={`/api/${secondaryProvider === "OUTLOOK" ? "outlook" : "gmail"}/connect?workspaceId=${workspaceId}`}
              className="connect-gmail-cta-secondary"
            >
              {secondaryProvider === "OUTLOOK" ? (
                <Trans>Prefer Outlook? Connect Outlook instead</Trans>
              ) : (
                <Trans>Prefer Gmail? Connect Gmail instead</Trans>
              )}
            </a>
          )}
        </div>
      </div>
      {showAziru && <AziruIntroDialog onClose={() => setShowAziru(false)} />}
    </div>
  );
}
