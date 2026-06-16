import type { Metadata } from "next";
import { ProseLayout } from "@/components/ProseLayout";

export const metadata: Metadata = {
  title: "Privacy Policy | Amarnai",
  description: "How Amarnai collects, uses, and protects your data.",
};

const LAST_UPDATED = "June 16, 2026";

export default function PrivacyPage() {
  return (
    <ProseLayout>
      <h1 className="prose-title">Privacy Policy</h1>
      <p className="prose-meta">Last updated: {LAST_UPDATED}</p>

      <p>
        This Privacy Policy describes how Amarnai (&ldquo;we&rdquo;, &ldquo;our&rdquo;,
        &ldquo;us&rdquo;) collects, uses, and protects information when you use our AI
        email triage service at amarnai.com (&ldquo;the Service&rdquo;).
      </p>

      <h2>Google API Data</h2>
      <p>
        Amarnai&rsquo;s use of information received from Google APIs will adhere to the{" "}
        <a
          href="https://developers.google.com/terms/api-services-user-data-policy"
          target="_blank"
          rel="noopener noreferrer"
        >
          Google API Services User Data Policy
        </a>
        , including the Limited Use requirements.
      </p>
      <p>
        Specifically, Gmail data accessed through the Google API is used solely to
        provide the email triage and sorting features visible in the Amarnai interface.
        It is not used for advertising, transferred to third parties for purposes
        unrelated to providing the Service, or used to train generalized AI or machine
        learning models.
      </p>

      <h2>What We Collect</h2>
      <p>We collect only the data necessary to provide the Service:</p>
      <ul>
        <li>
          <strong>Account information:</strong> your name and email address, obtained
          from Google at sign-in.
        </li>
        <li>
          <strong>Gmail thread metadata and content:</strong> subject lines, sender and
          recipient addresses, message bodies, and timestamps, fetched via the Gmail
          API to classify and sort your threads.
        </li>
        <li>
          <strong>OAuth tokens:</strong> encrypted refresh tokens that allow Amarnai to
          access Gmail on your behalf. These are stored encrypted at rest and never
          logged.
        </li>
        <li>
          <strong>Usage data:</strong> actions you take in the app (e.g., changing
          taxonomy rules, triggering a sync) to operate and improve the Service.
        </li>
      </ul>
      <p>
        We do not store full email bodies beyond what is required to display a thread
        in your Amarnai inbox.
      </p>

      <h2>How We Use Your Data</h2>
      <p>Gmail and account data is used exclusively to:</p>
      <ul>
        <li>Classify and sort your email threads using AI.</li>
        <li>Display threads and their assigned categories in the Amarnai UI.</li>
        <li>Notify you of new high-priority messages.</li>
        <li>
          Provide actions you explicitly request, such as composing, sending, or
          deleting messages.
        </li>
      </ul>
      <p>
        We do not use your email content for advertising, sell it to third parties, or
        use it to train models that are not specific to your account.
      </p>

      <h2>AI Processing</h2>
      <p>
        Thread classification is performed by a third-party AI provider (currently
        Anthropic). Thread content sent for classification is processed under
        Anthropic&rsquo;s{" "}
        <a
          href="https://www.anthropic.com/legal/privacy"
          target="_blank"
          rel="noopener noreferrer"
        >
          Privacy Policy
        </a>{" "}
        and is not used to train Anthropic&rsquo;s general models under their API usage
        policy. We send only the minimum content needed for classification.
      </p>

      <h2>Third-Party Services</h2>
      <p>We use the following third-party services to operate the Service:</p>
      <ul>
        <li>
          <strong>Google (Gmail API, OAuth 2.0):</strong> to authenticate you and
          access your Gmail data with your permission.
        </li>
        <li>
          <strong>Anthropic:</strong> to classify email threads using AI. Governed by
          Anthropic&rsquo;s API data usage policy.
        </li>
        <li>
          <strong>Stripe:</strong> to process subscription payments. Stripe handles
          payment card data; Amarnai does not store card numbers.
        </li>
      </ul>
      <p>
        We do not share your email content or Gmail data with any third party except as
        described above to provide the Service.
      </p>

      <h2>Data Retention</h2>
      <p>
        Thread metadata and content is retained while your account is active. When you
        delete your account, all of your data, including thread metadata and content, is
        permanently deleted as part of the deletion request, with no recovery period.
        OAuth tokens are deleted immediately upon Gmail disconnection or account
        deletion. Deletion is permanent and cannot be undone.
      </p>

      <h2>Your Rights and Data Deletion</h2>
      <p>You can manage and delete your data at any time:</p>
      <ul>
        <li>
          <strong>Disconnect Gmail:</strong> go to Settings in the Amarnai app and
          click &ldquo;Disconnect Gmail&rdquo;. This immediately revokes our access and
          deletes your stored OAuth token.
        </li>
        <li>
          <strong>Delete your account:</strong> go to Settings and click &ldquo;Delete
          account&rdquo;. All your data is permanently and immediately deleted. This
          cannot be undone.
        </li>
        <li>
          <strong>Revoke Google access directly:</strong> visit{" "}
          <a
            href="https://myaccount.google.com/permissions"
            target="_blank"
            rel="noopener noreferrer"
          >
            myaccount.google.com/permissions
          </a>{" "}
          and remove Amarnai from the list of connected apps.
        </li>
      </ul>
      <p>
        To request a copy of your data or ask questions about deletion, email us at{" "}
        <a href="mailto:hello@amarnai.com">hello@amarnai.com</a>.
      </p>

      <h2>Security</h2>
      <p>
        OAuth refresh tokens and API keys are encrypted at rest using AES-256-GCM
        before being written to the database, with encryption keys stored separately
        from the data they protect. Access tokens are short-lived, exist only in
        memory during a request, and are never persisted or logged. Email content is
        never written to application logs.
      </p>
      <p>
        All data is transmitted over TLS. Access to production systems is restricted
        to authorized personnel and protected by multi-factor authentication. Because
        Amarnai accesses Gmail data, we undergo an annual third-party security
        assessment (CASA) conducted by a lab accredited by the{" "}
        <a
          href="https://appdefensealliance.dev"
          target="_blank"
          rel="noopener noreferrer"
        >
          App Defense Alliance
        </a>
        , as required by Google for restricted-scope OAuth apps.
      </p>
      <p>
        If you discover a security vulnerability in Amarnai, please report it to{" "}
        <a href="mailto:hello@amarnai.com">hello@amarnai.com</a>. We will acknowledge
        your report within 2 business days and ask that you do not publicly disclose
        the issue until we have had a reasonable opportunity to address it.
      </p>

      <h2>Children</h2>
      <p>
        The Service is not directed at children under 13. We do not knowingly collect
        data from children.
      </p>

      <h2>Changes to This Policy</h2>
      <p>
        We will post any material changes to this policy on this page and update the
        &ldquo;Last updated&rdquo; date above. Continued use of the Service after
        changes take effect constitutes acceptance of the revised policy.
      </p>

      <h2>Contact</h2>
      <p>
        Questions about this policy or your data can be sent to{" "}
        <a href="mailto:hello@amarnai.com">hello@amarnai.com</a>.
      </p>
    </ProseLayout>
  );
}
