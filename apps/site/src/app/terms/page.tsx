import type { Metadata } from "next";
import { ProseLayout } from "@/components/ProseLayout";

export const metadata: Metadata = {
  title: "Terms of Service | Amarnai",
  description: "Terms governing your use of Amarnai.",
};

const LAST_UPDATED = "July 8, 2026";

export default function TermsPage() {
  return (
    <ProseLayout>
      <h1 className="prose-title">Terms of Service</h1>
      <p className="prose-meta">Last updated: {LAST_UPDATED}</p>

      <p>
        These Terms of Service (&ldquo;Terms&rdquo;) govern your use of Amarnai
        (&ldquo;the Service&rdquo;), operated by Amarnai (&ldquo;we&rdquo;,
        &ldquo;our&rdquo;, &ldquo;us&rdquo;). By using the Service you agree to these
        Terms.
      </p>

      <h2>The Service</h2>
      <p>
        Amarnai is an AI-assisted email triage tool. It connects to your Gmail or Outlook
        account with your permission and sorts, classifies, and displays your threads. Actions
        that modify or send email always require explicit user confirmation.
      </p>

      <h2>Your Account</h2>
      <p>
        You must provide accurate information when creating an account. You are
        responsible for maintaining the security of your credentials and for all
        activity that occurs under your account. Notify us immediately at{" "}
        <a href="mailto:hello@amarnai.com">hello@amarnai.com</a> if you suspect
        unauthorized access.
      </p>

      <h2>Mailbox Access</h2>
      <p>
        You grant Amarnai permission to access your Gmail account through Google&rsquo;s
        OAuth 2.0 API, or your Outlook account through Microsoft&rsquo;s Graph API. You
        can revoke this permission at any time from the Amarnai Settings page, from{" "}
        <a
          href="https://myaccount.google.com/permissions"
          target="_blank"
          rel="noopener noreferrer"
        >
          myaccount.google.com/permissions
        </a>
        , or from{" "}
        <a
          href="https://account.live.com/consent/Manage"
          target="_blank"
          rel="noopener noreferrer"
        >
          account.live.com/consent/Manage
        </a>{" "}
        (or{" "}
        <a
          href="https://myapps.microsoft.com"
          target="_blank"
          rel="noopener noreferrer"
        >
          myapps.microsoft.com
        </a>{" "}
        for work or school accounts). Revoking access stops all mail-related features
        but does not delete your account.
      </p>
      <p>
        Amarnai&rsquo;s use of Gmail and Outlook data is governed by our{" "}
        <a href="/privacy">Privacy Policy</a> and the{" "}
        <a
          href="https://developers.google.com/terms/api-services-user-data-policy"
          target="_blank"
          rel="noopener noreferrer"
        >
          Google API Services User Data Policy
        </a>
        , including the Limited Use requirements.
      </p>

      <h2>Acceptable Use</h2>
      <p>You agree not to:</p>
      <ul>
        <li>Use the Service for any unlawful purpose.</li>
        <li>Attempt to gain unauthorized access to Amarnai systems or other users&rsquo; accounts.</li>
        <li>Reverse engineer, decompile, or tamper with the Service.</li>
        <li>Use the Service to send unsolicited messages or spam.</li>
        <li>
          Resell or sublicense access to the Service without our written permission.
        </li>
      </ul>

      <h2>Subscription and Billing</h2>
      <p>
        Some features require a paid subscription. Subscriptions are billed in advance
        on a monthly or annual basis. You can cancel at any time from the Settings
        page; your access continues until the end of the current billing period.
        Payments are processed by Stripe. We do not store payment card numbers.
      </p>
      <p>
        We reserve the right to change pricing with at least 30 days&rsquo; notice to
        your account email address.
      </p>

      <h2>Open Source</h2>
      <p>
        Amarnai&rsquo;s source code is available under the AGPL-3.0 license. The
        license terms govern your right to use, modify, and distribute the code. These
        Terms govern your use of the hosted Service at amarnai.com and do not restrict
        your rights under the open-source license.
      </p>

      <h2>Disclaimer of Warranties</h2>
      <p>
        The Service is provided &ldquo;as is&rdquo; without warranty of any kind.
        Amarnai makes no guarantees that the Service will be uninterrupted, error-free,
        or that AI classifications will be accurate. You are responsible for reviewing
        any actions before confirming them.
      </p>

      <h2>Limitation of Liability</h2>
      <p>
        To the maximum extent permitted by law, Amarnai is not liable for any indirect,
        incidental, or consequential damages arising from your use of the Service,
        including loss of data or unintended email actions. Our total liability to you
        for any claim arising from these Terms or the Service is limited to the amount
        you paid us in the 12 months preceding the claim.
      </p>

      <h2>Termination</h2>
      <p>
        You may stop using the Service and delete your account at any time from
        Settings. Deleting your account permanently removes your data as described in
        our <a href="/privacy">Privacy Policy</a>. We may suspend or terminate your
        account if you violate these Terms, with notice where reasonably practicable.
      </p>

      <h2>Changes to These Terms</h2>
      <p>
        We will notify you of material changes by email or by a notice in the app at
        least 14 days before they take effect. Continued use of the Service after
        changes take effect constitutes acceptance.
      </p>

      <h2>Governing Law</h2>
      <p>
        These Terms are governed by the laws of the State of Wyoming, United States,
        without regard to conflict of law principles. Disputes will be resolved in the
        state or federal courts located in Wyoming.
      </p>

      <h2>Contact</h2>
      <p>
        Questions about these Terms:{" "}
        <a href="mailto:hello@amarnai.com">hello@amarnai.com</a>
      </p>
    </ProseLayout>
  );
}
