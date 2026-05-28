type Props = {
  workspaceId: string;
};

export function ConnectGmailCta({ workspaceId }: Props) {
  return (
    <div className="connect-gmail-cta">
      <p className="connect-gmail-cta-title">No Gmail inbox connected</p>
      <p className="connect-gmail-cta-description">
        Connect your Gmail account to start syncing and sorting your email threads.
      </p>
      <a
        href={`/api/gmail/connect?workspaceId=${workspaceId}`}
        className="btn-primary"
      >
        Connect Gmail
      </a>
    </div>
  );
}
