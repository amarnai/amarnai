import Image from "next/image";
import { Trans } from "@lingui/react/macro";
import { GoogleGIcon } from "@amarnai/ui";

type Props = {
  workspaceId: string;
  /** True when a disconnected connection already exists, so this is a reconnect. */
  reconnect?: boolean;
};

export function ConnectGmailCta({ workspaceId, reconnect = false }: Props) {
  return (
    <div className="connect-gmail-cta-wrap">
      <div className="connect-gmail-cta">
        <div className="connect-gmail-cta-mascot">
          <Image
            src="/aziru-safe.png"
            alt="King Aziru"
            width={240}
            height={240}
            priority
            style={{ width: 240, height: "auto" }}
          />
        </div>
        <div className="connect-gmail-cta-body">
          <p className="connect-gmail-cta-title">
            {reconnect ? (
              <Trans>Reconnect your Gmail inbox</Trans>
            ) : (
              <Trans>Connect your Gmail inbox</Trans>
            )}
          </p>
          <p className="connect-gmail-cta-description">
            {reconnect ? (
              <Trans>
                Amarnai is no longer syncing this inbox. Reconnect your Gmail
                account to resume sorting your email threads. Access stays{" "}
                <strong>read-only</strong>, and your inbox stays yours.
              </Trans>
            ) : (
              <Trans>
                King Aziru is ready to sort your email threads. Connect your
                Gmail account to get started. Amarnai connects with{" "}
                <strong>read-only access</strong> and{" "}
                <strong>never sends, deletes, or changes anything</strong>. Your
                inbox stays yours.
              </Trans>
            )}
          </p>
          <a
            href={`/api/gmail/connect?workspaceId=${workspaceId}`}
            className="btn-primary connect-gmail-cta-btn"
          >
            <GoogleGIcon variant="mono" size={16} />
            {reconnect ? <Trans>Reconnect Gmail</Trans> : <Trans>Connect Gmail</Trans>}
          </a>
        </div>
      </div>
    </div>
  );
}
