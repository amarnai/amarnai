# Data Protection Impact Assessment (DPIA)

| | |
|---|---|
| **Processing assessed** | Amarnai hosted service (app.amarnai.com): AI-assisted email triage |
| **Controller** | TODO(business): legal entity name and address (Wyoming, USA) |
| **Document owner** | TODO(business): named individual accountable for this DPIA |
| **Version** | 0.1 |
| **Date** | 2026-07-16 |
| **Status** | Draft, pending counsel review |
| **Scope note** | Covers the hosted SaaS only. Self-hosted deployments of the open-source code are operated by their own controllers and are out of scope. |

## 1. Why a DPIA is required

Article 35(1) GDPR requires a DPIA where processing is likely to result in a high risk to the rights and freedoms of natural persons, in particular when using new technologies. This processing meets several of the EDPB WP248 criteria:

- **Large-scale processing**: the service ingests and stores complete email threads (metadata and body text) for every connected mailbox, including bulk backfill of historical inboxes containing thousands of messages.
- **Sensitive or highly personal data, incidentally**: an inbox is uncurated. Message bodies routinely contain special-category data within the meaning of Article 9 (health correspondence, political or union membership mailings, religious communications) even though Amarnai does not seek or use such data.
- **Innovative technology**: large language models classify, embed, and draft replies to the content.
- **Data concerning persons other than the user**: senders and other participants in the user's threads are data subjects who have no direct relationship with Amarnai.

Conclusion: a DPIA is mandatory before processing EU/EEA personal data at scale in the hosted offering.

## 2. Description of the processing

### 2.1 Purpose

Sort, classify, and prioritize the user's email threads; suggest categories; generate reply drafts that the user must explicitly approve. Amarnai never sends mail and never deletes mail. Its only mailbox mutation is label writeback: mirroring the user's folder structure into the mailbox as Gmail labels / Outlook categories under an `Amarnai` namespace, and keeping them in sync as threads are sorted. It reconciles only the labels it created, never the user's own, and changes nothing else about a message (no move, no archive, no read-state change, no content edit).

### 2.2 Data flows (as implemented)

1. **Ingestion**: with the user's OAuth consent, threads are fetched via the Gmail API (`gmail.readonly`) or Microsoft Graph (`Mail.Read`). Refresh tokens are encrypted with AES-256-GCM before storage (`packages/gmail/src/encryption.ts`); access tokens live only in memory during a request.
1b. **Label writeback (optional, write path)**: when the deployment flag is on and the user granted the write scope (`gmail.modify`, or `Mail.ReadWrite` + `MailboxSettings.ReadWrite`), the worker creates the `Amarnai` label/category namespace and applies the matching label to each sorted thread (`packages/gmail/src/gmail-client.ts`, `apps/worker/src/jobs/provision-folder-labels.ts`). No personal data leaves Amarnai on this path: the payload is a folder name the user chose. Declining the write permission leaves the connection read-only and the feature inert.
2. **Storage**: thread metadata and message content (sender, recipients, subject, snippet, body text, attachment metadata) are stored in PostgreSQL (`EmailThread`, `EmailMessage` in `packages/db/prisma/schema.prisma`). Full email bodies are never written to logs.
3. **AI processing**: classification, category suggestion, and draft generation call the Google Gemini API (production model `gemini-2.5-flash-lite`); embeddings use `gemini-embedding-001`. The payload per task is limited to sender, subject, and body excerpts (`packages/ai/src/thread-snapshot.ts`), not full mailbox exports. Paid API tier: content is not used to train Google's models.
4. **Transactional email**: verification, password reset, invitation, and lifecycle messages are delivered via Resend (recipient address plus message content).
5. **Billing**: Stripe processes payment; Amarnai stores Stripe customer/subscription/price identifiers and an opaque card fingerprint token, never card numbers. Checkout collects billing address and tax ID within Stripe.
6. **Push notifications** (mobile, currently shelved): notification payloads carry the thread subject only, never body content.
7. **Analytics**: cookieless, EU-hosted, aggregate-only (Umami); no cross-site tracking, no stored IP addresses.
8. **Deletion**: user-initiated account deletion (with password step-up) revokes OAuth grants, cancels Stripe subscriptions (with a durable retry record), and cascade-deletes all account data (`deleteUserCascade`, `packages/db/src/workspace-ops.ts`). A narrow set of anti-abuse records survives; see the Legitimate Interest Assessment (`legitimate-interest-assessment.md`).

### 2.3 Data subjects

- Account holders (users).
- Third-party correspondents appearing in the user's threads (senders, recipients), who have no direct relationship with Amarnai.

### 2.4 Recipients and transfers

Google (Gmail API as data source; Gemini API as AI processor), Microsoft (Graph API as data source), Stripe (billing), Resend (email delivery), hosting/database provider (TODO(business): name provider and region). All named providers are US companies; transfer safeguards are tracked in `dpa-transfer-checklist.md`.

### 2.5 Retention

Email data: life of the account or until mailbox disconnection/workspace reset. Notifications: 90 days. Idempotency markers: 90 days. Unverified accounts: reaped after 7 days. Post-deletion anti-abuse records: see LIA.

## 3. Necessity and proportionality

- **Lawful basis**: performance of contract (Article 6(1)(b)) for the core triage service the user signs up for; legitimate interest (Article 6(1)(f)) for anti-abuse retention and service communications.
- **Purpose limitation**: mailbox data is used only for triage, classification, and user-approved drafting. No advertising, no profiling beyond the service's stated function, no sale of data.
- **Data minimization**: OAuth scopes limited to reading mail plus, only when the user enables writeback, the narrowest write scope that can label it (`gmail.modify`, not `https://mail.google.com/`); AI payloads limited to excerpts; sign-up collects only an email address; push payloads exclude body content; deleted-account residue is limited to hashes, fingerprint tokens, and counters.
- **Third-party correspondent data**: processing their data is intrinsic to any email tool and is covered by the Article 14(5)(b) disproportionate-effort exemption for direct notice; the public privacy policy serves as the accessible information source. TODO(counsel): confirm this position.
- **Google API Services User Data Policy / Limited Use**: complied with; CASA Tier 2 security assessment cleared July 2026.

## 4. Risks to data subjects

| # | Risk | Likelihood | Severity | Notes |
|---|------|-----------|----------|-------|
| R1 | Incidental special-category content sent to a US AI provider (Gemini) | High (occurs by nature of email) | Medium | Content is excerpted, not used for training (paid tier), transient at provider |
| R2 | Third-party correspondents processed without direct notice | Certain | Low-Medium | Inherent to email tooling; Art. 14(5)(b) relied upon |
| R3 | OAuth token compromise granting mailbox read access | Low | High | AES-256-GCM at rest, keys separate, short-lived access tokens |
| R4 | Database breach exposing stored email bodies | Low | High | Bodies stored plaintext in Postgres; encryption at rest depends on hosting provider (TODO(business): confirm disk/volume encryption) |
| R5 | International transfer invalidation (Schrems-type event) | Low | Medium | Disjunctive safeguards (DPF or SCCs); monitored via checklist |
| R6 | AI misclassification causing a user to miss important mail | Medium | Low-Medium | Product risk with privacy dimension; user retains full inbox in Gmail/Outlook, Amarnai is not the mailbox |
| R7 | Post-deletion retention perceived as ignoring erasure rights | Low | Low | Disclosed in the privacy policy; records are minimal and non-contactable; LIA documents the basis |

## 5. Mitigations

- R1: keep excerpt-based payloads; contractually confirmed no-training tier; TODO(business): evaluate Google Cloud EU-region Gemini endpoints or EU data-residency options when available for the workload.
- R2: privacy policy describes correspondent data handling; deletion of a user removes correspondent data held on their behalf. TODO(counsel): validate Art. 14(5)(b) reliance in writing.
- R3: existing encryption controls; immediate token deletion on disconnect; revocation calls to Google on disconnect/deletion.
- R4: TODO(business): confirm hosting provider's encryption at rest and access controls; TODO(engineering, optional hardening): evaluate application-layer encryption of message bodies.
- R5: maintain `dpa-transfer-checklist.md`; re-verify vendor DPF status annually.
- R6: drafts require explicit user approval; no auto-send by design; mail is never deleted or moved destructively.
- R7: disclosure shipped in the privacy policy (July 16, 2026 revision); LIA maintained; objection route via privacy@amarnai.com.

## 6. Consultation and sign-off

- **DPO**: not currently mandatory to appoint under Article 37 (TODO(counsel): confirm given scale trajectory); privacy contact is privacy@amarnai.com.
- **EU representative (Article 27)**: required, not yet appointed. Tracked as an action item in `dpa-transfer-checklist.md`.
- **Prior consultation (Article 36)**: not triggered provided the mitigations above are in place, since residual risk is assessed as medium or below. Re-assess if R4 mitigations cannot be confirmed.
- **Review cadence**: annually, and upon any of: change of AI provider or model host, change of hosting provider or region, addition of a new category of data processed, or a relevant transfer-law development.
- **Sign-off**: TODO(business): name, role, date.
