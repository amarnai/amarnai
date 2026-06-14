import Image from "next/image";

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
            src="/aziru-start.png"
            alt="King Aziru"
            width={220}
            height={288}
            priority
            style={{ width: 240, height: "auto" }}
          />
        </div>
        <div className="connect-gmail-cta-body">
          <p className="connect-gmail-cta-title">
            {reconnect ? "Reconnect your Gmail inbox" : "Connect your Gmail inbox"}
          </p>
          <p className="connect-gmail-cta-description">
            {reconnect
              ? "Amarnai is no longer syncing this inbox. Reconnect your Gmail account to resume sorting your email threads."
              : "King Aziru is ready to sort your email threads. Connect your Gmail account to get started."}
          </p>
          <a
            href={`/api/gmail/connect?workspaceId=${workspaceId}`}
            className="btn-primary connect-gmail-cta-btn"
          >
            {reconnect ? "Reconnect Gmail" : "Connect Gmail"}
          </a>
        </div>
      </div>
    </div>
  );
}
