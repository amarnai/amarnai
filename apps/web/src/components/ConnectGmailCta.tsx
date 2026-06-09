import Image from "next/image";

type Props = {
  workspaceId: string;
};

export function ConnectGmailCta({ workspaceId }: Props) {
  return (
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
        <p className="connect-gmail-cta-title">Connect your Gmail inbox</p>
        <p className="connect-gmail-cta-description">
          King Aziru is ready to sort your threads. Connect your Gmail account to get started.
        </p>
        <a
          href={`/api/gmail/connect?workspaceId=${workspaceId}`}
          className="btn-primary connect-gmail-cta-btn"
        >
          Connect Gmail
        </a>
      </div>
    </div>
  );
}
