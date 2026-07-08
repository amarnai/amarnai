import type { Metadata } from "next";
import { ProseLayout } from "@/components/ProseLayout";

export const metadata: Metadata = {
  title: "Delete Your Account | Amarnai",
  description: "How to delete your Amarnai account and the data it removes.",
};

const LAST_UPDATED = "July 8, 2026";

export default function DeleteAccountPage() {
  return (
    <ProseLayout>
      <h1 className="prose-title">Delete Your Account</h1>
      <p className="prose-meta">Last updated: {LAST_UPDATED}</p>

      <p>
        This page explains how to permanently delete your Amarnai account and
        everything associated with it. You can start account deletion yourself
        from the Amarnai app on the web or on mobile, no request or waiting
        period required.
      </p>

      <h2>Delete Your Whole Account</h2>
      <p>Choose whichever way you use Amarnai:</p>
      <ul>
        <li>
          <strong>On the web:</strong> sign in at amarnai.com, open{" "}
          <strong>Account</strong>, scroll to the{" "}
          <strong>Danger zone</strong>, and click{" "}
          <strong>Delete account</strong>. If you signed up with a password,
          you will be asked to re-enter it to confirm.
        </li>
        <li>
          <strong>On mobile:</strong> open <strong>Account</strong>, scroll to
          the <strong>Danger zone</strong>, and tap{" "}
          <strong>Delete account</strong>.
        </li>
        <li>
          <strong>Revoke access from Google:</strong> you can also remove
          Amarnai&rsquo;s access to your Google account at any time by visiting{" "}
          <a
            href="https://myaccount.google.com/permissions"
            target="_blank"
            rel="noopener noreferrer"
          >
            myaccount.google.com/permissions
          </a>{" "}
          and removing Amarnai from the list of connected apps.
        </li>
        <li>
          <strong>Revoke access from Microsoft:</strong> you can also remove
          Amarnai&rsquo;s access to your Microsoft account at any time. For a
          personal account, visit{" "}
          <a
            href="https://account.live.com/consent/Manage"
            target="_blank"
            rel="noopener noreferrer"
          >
            account.live.com/consent/Manage
          </a>
          ; for a work or school account, visit{" "}
          <a
            href="https://myapps.microsoft.com"
            target="_blank"
            rel="noopener noreferrer"
          >
            myapps.microsoft.com
          </a>
          . Then remove Amarnai from the list of connected apps.
        </li>
      </ul>

      <h2>What Gets Deleted</h2>
      <p>
        Deleting your account is permanent, immediate, and irreversible. It
        removes:
      </p>
      <ul>
        <li>Your account and sign-in credentials.</li>
        <li>All workspaces you own.</li>
        <li>
          All synced email data, including thread metadata, message content,
          classifications, and tags.
        </li>
        <li>Your settings and preferences.</li>
        <li>Your taxonomy, including any categories and rules you created.</li>
        <li>
          Your Gmail or Outlook connection and stored OAuth tokens, revoked and
          deleted.
        </li>
        <li>Any paid subscription, which is cancelled as part of deletion.</li>
      </ul>
      <p>
        Once deleted, your data cannot be recovered. There is no grace period
        and no way to undo the deletion.
      </p>

      <h2>If You Do Not Want to Delete Everything</h2>
      <p>
        You do not have to delete your whole account to remove data. From the
        Amarnai app you can instead:
      </p>
      <ul>
        <li>
          <strong>Disconnect your inbox and erase synced data:</strong> revokes
          Amarnai&rsquo;s access to Gmail or Outlook, deletes your stored OAuth token,
          and
          erases the email data synced into the workspace. Your account and
          workspaces are kept.
        </li>
        <li>
          <strong>Reset a workspace:</strong> clears the workspace&rsquo;s
          synced emails and taxonomy back to a clean state while keeping the
          workspace and your account.
        </li>
        <li>
          <strong>Delete a single workspace:</strong> permanently removes one
          workspace and all of its data, leaving your account and any other
          workspaces intact.
        </li>
      </ul>

      <h2>Data Retention</h2>
      <p>
        Thread metadata and content is retained while your account is active.
        When you delete your account, all of your data, including thread
        metadata and content, is permanently deleted as part of the deletion
        request, with no recovery period. OAuth tokens are deleted immediately
        upon Gmail or Outlook disconnection or account deletion. Deletion is
        permanent and cannot be undone.
      </p>

      <h2>Need Help?</h2>
      <p>
        If you cannot access your account or have questions about deletion,
        email us at{" "}
        <a href="mailto:privacy@amarnai.com">privacy@amarnai.com</a> and we will
        help you delete your data.
      </p>
    </ProseLayout>
  );
}
