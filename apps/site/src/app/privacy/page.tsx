import type { Metadata } from "next";
import { ProseLayout } from "@/components/ProseLayout";

export const metadata: Metadata = {
  title: "Privacy Policy | Amarnai",
  description: "How Amarnai collects, uses, and protects your data.",
};

const LAST_UPDATED = "July 16, 2026";

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
        Specifically, Gmail data accessed through the Google API, and Outlook data
        accessed through the Microsoft Graph API, is used solely to provide the email
        triage and sorting features visible in the Amarnai interface.
        It is not used for advertising, transferred to third parties for purposes
        unrelated to providing the Service, or used to train generalized AI or machine
        learning models.
      </p>

      <h2>What We Collect</h2>
      <p>We collect only the data necessary to provide the Service:</p>
      <ul>
        <li>
          <strong>Account information:</strong> your name and email address, obtained
          from Google or Microsoft at sign-in.
        </li>
        <li>
          <strong>Gmail or Outlook thread metadata and content:</strong> subject lines,
          sender and recipient addresses, message bodies, and timestamps, fetched via the
          Gmail API or Microsoft Graph API to classify and sort your threads.
        </li>
        <li>
          <strong>OAuth tokens:</strong> encrypted refresh tokens that allow Amarnai to
          access Gmail or Outlook on your behalf. These are stored encrypted at rest and
          never logged.
        </li>
        <li>
          <strong>Usage data:</strong> actions you take in the app (e.g., changing
          plan rules, triggering a sync) to operate and improve the Service.
        </li>
      </ul>
      <p>
        We do not store full email bodies beyond what is required to display a thread
        in your Amarnai inbox.
      </p>

      <h2>How We Use Your Data</h2>
      <p>Gmail, Outlook, and account data is used exclusively to:</p>
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
        Thread classification, category suggestions, and reply drafts are produced by a
        third-party AI provider, Google, through the Gemini API. Embeddings used to
        organize and match your threads are also computed through the Gemini API. The
        content we send for processing is limited to what each task needs: typically
        the sender, the subject line, and excerpts of message bodies. This content is
        processed under the{" "}
        <a
          href="https://ai.google.dev/gemini-api/terms"
          target="_blank"
          rel="noopener noreferrer"
        >
          Gemini API Additional Terms of Service
        </a>{" "}
        and Google&rsquo;s{" "}
        <a
          href="https://policies.google.com/privacy"
          target="_blank"
          rel="noopener noreferrer"
        >
          Privacy Policy
        </a>
        . We use the paid tier of the Gemini API, under which Google does not use
        submitted content to train or improve its models.
      </p>

      <h2>Third-Party Services</h2>
      <p>We use the following third-party services to operate the Service:</p>
      <ul>
        <li>
          <strong>Google (Gmail API, OAuth 2.0):</strong> to authenticate you and
          access your Gmail data with your permission.
        </li>
        <li>
          <strong>Microsoft (Microsoft Graph API, OAuth 2.0):</strong> to authenticate
          you and access your Outlook data with your permission.
        </li>
        <li>
          <strong>Google (Gemini API):</strong> to classify email threads, suggest
          categories, compute embeddings, and generate drafts using AI. Governed by the
          Gemini API terms; content submitted through the paid API tier is not used to
          train Google&rsquo;s models.
        </li>
        <li>
          <strong>Stripe:</strong> to process subscription payments. Stripe handles
          payment card data; Amarnai does not store card numbers.
        </li>
        <li>
          <strong>Resend:</strong> to deliver transactional email from Amarnai to you,
          such as verification, password reset, invitation, and account lifecycle
          messages. Resend processes the recipient address and the content of each
          message it delivers on our behalf.
        </li>
      </ul>
      <p>
        We do not share your email content, Gmail data, or Outlook data with any third
        party except as described above to provide the Service.
      </p>

      <h2>Analytics</h2>
      <p>
        On our website (amarnai.com) we use a privacy-focused, cookieless analytics
        service to understand how visitors find and use the site. It sets no cookies and
        stores no information on your device, and it does not track you across other
        websites. It collects only aggregated, anonymous statistics, such as pages
        viewed, referring site, browser, operating system, device type, and approximate
        country, derived without storing your IP address. This data cannot be used to
        identify you. We process it on the basis of our legitimate interest in measuring
        and improving the website. Analytics data is hosted in the European Union.
      </p>

      <h2>Data Retention</h2>
      <p>
        Thread metadata and content is retained while your account is active. When you
        delete your account, your account data, including thread metadata and content,
        is permanently deleted as part of the deletion request, with no recovery
        period. OAuth tokens are deleted immediately upon Gmail or Outlook
        disconnection or account deletion. Deletion is permanent and cannot be undone.
      </p>
      <p>
        A narrow set of anti-abuse and billing-integrity records survives account
        deletion. First, a trial claim record: a one-way (SHA-256) hash of your
        normalized email address and, where a card was used, an opaque card fingerprint
        token provided by Stripe, together with the Stripe subscription identifier.
        This record exists so that the single free trial cannot be claimed again by
        deleting and recreating an account. The hash cannot be reversed to recover your
        email address, and the record cannot be used to contact you. Second, aggregate
        usage meters keyed on the normalized address of a connected inbox, containing
        only counters of AI processing consumed. These prevent repeated account resets
        from generating unlimited processing costs. We retain both kinds of record on
        the basis of our legitimate interest in preventing abuse of the Service and
        accounting for processing costs (Article 6(1)(f) GDPR). They contain no email
        content, no names, and no other profile data.
      </p>

      <h2>International Data Transfers</h2>
      <p>
        Amarnai is operated from the United States, and the third-party providers
        listed above (Google, Stripe, and Resend) are United States companies. Where
        personal data of users in the European Economic Area, the United Kingdom, or
        Switzerland is transferred to the United States, we rely on providers that are
        certified under the EU-US Data Privacy Framework (including its UK and Swiss
        extensions) or that are bound by Standard Contractual Clauses, together with
        the data processing agreements we hold with each provider. You can request a
        summary of the safeguards that apply to a specific provider by emailing{" "}
        <a href="mailto:privacy@amarnai.com">privacy@amarnai.com</a>.
      </p>

      <h2>Your Rights and Data Deletion</h2>
      <p>You can manage and delete your data at any time:</p>
      <ul>
        <li>
          <strong>Disconnect your inbox:</strong> go to Settings in the Amarnai app and
          click &ldquo;Disconnect Gmail&rdquo; or &ldquo;Disconnect Outlook&rdquo;. This
          immediately revokes our access and deletes your stored OAuth token.
        </li>
        <li>
          <strong>Delete your account:</strong> go to Settings and click &ldquo;Delete
          account&rdquo;. Your account data is permanently and immediately deleted,
          except for the narrow anti-abuse records described under Data Retention.
          This cannot be undone.
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
        <li>
          <strong>Revoke Microsoft access directly:</strong> for a personal
          Microsoft account, visit{" "}
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
      <p>
        If you are in the European Economic Area, the United Kingdom, or Switzerland,
        you also have the right to access the personal data we hold about you, to have
        it corrected or erased, to receive a copy of it in a portable format, to
        restrict or object to certain processing (including processing based on our
        legitimate interests), and to withdraw consent where processing is based on
        consent. You also have the right to lodge a complaint with your local data
        protection supervisory authority. To exercise any of these rights, or to ask
        questions about deletion, email{" "}
        <a href="mailto:privacy@amarnai.com">privacy@amarnai.com</a>. We respond to
        requests within one month.
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
        <a href="mailto:privacy@amarnai.com">privacy@amarnai.com</a>.
      </p>
    </ProseLayout>
  );
}
