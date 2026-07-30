# Records of Processing Activities (Article 30 GDPR)

| | |
|---|---|
| **Controller** | TODO(business): legal entity name, registered address (Wyoming, USA), registration number |
| **EU representative (Art. 27)** | TODO(business): not yet appointed; see action item in `dpa-transfer-checklist.md` |
| **UK representative** | TODO(business): assess and appoint if UK users are served |
| **Privacy contact** | privacy@amarnai.com |
| **DPO** | None appointed (TODO(counsel): confirm not required) |
| **Version / date** | 0.1 / 2026-07-16, draft pending counsel review |
| **Scope** | Hosted SaaS (app.amarnai.com) only; self-hosted deployments are their own controllers |

General security measures applying to all activities (Art. 30(1)(g)): OAuth refresh tokens and API keys encrypted at rest with AES-256-GCM, encryption keys stored separately; access tokens held in memory only; passwords stored as hashes; no email bodies in logs; audit logging of important actions; account deletion requires password step-up; CASA Tier 2 assessment cleared July 2026; TODO(business): hosting provider security measures (disk encryption, network isolation, backups) once provider is documented.

## Processing activities

### 1. Account management and authentication

| Field | Detail |
|---|---|
| Purpose | Create and operate user accounts; sessions; email verification; password reset |
| Data subjects | Users |
| Data categories | Email address, name and avatar URL (if provided by Google), password hash, verification tokens, session/refresh token hashes, locale, timestamps |
| Recipients | Resend (delivery of verification/reset email) |
| Transfers | USA (Resend); safeguards per `dpa-transfer-checklist.md` |
| Retention | Life of account; unverified accounts reaped after 7 days; expired tokens pruned daily |

### 2. Email ingestion and display

| Field | Detail |
|---|---|
| Purpose | Fetch and store the user's mail threads for triage (read access to the mailbox) |
| Data subjects | Users; third-party correspondents in their threads |
| Data categories | Thread and message metadata, sender/recipient addresses and names, subjects, snippets, body text, attachment metadata; encrypted OAuth tokens |
| Recipients | Google (Gmail API), Microsoft (Graph API) as data sources; hosting/database provider (TODO(business)) |
| Transfers | USA; safeguards per checklist |
| Retention | Life of account or until mailbox disconnect / workspace reset; deletions in the source mailbox are mirrored |

### 2b. Label writeback into the mailbox (optional)

| Field | Detail |
|---|---|
| Purpose | Mirror the user's Amarnai folders into their mailbox as Gmail labels / Outlook categories under an `Amarnai` namespace, and keep them in sync as threads are sorted |
| Lawful basis | Performance of contract (Art. 6(1)(b)); the user enables it per workspace and grants the write scope explicitly |
| Data subjects | Users |
| Data categories | Folder names the user chose, and the mapping from thread to folder. No message content and no correspondent data is transmitted on this path |
| Recipients | Google (Gmail API), Microsoft (Graph API) as the destination mailbox |
| Transfers | USA; safeguards per checklist |
| Retention | Labels persist in the user's own mailbox until Amarnai removes them on re-sort, or the user deletes them. Amarnai reconciles only labels it created; the user's own labels are never modified |
| Notes | Off when the deployment flag is off, when the user switches it off, or when the write scope was declined. Amarnai never sends, deletes, moves, archives, or marks mail read |

### 3. AI classification, embeddings, and drafting

| Field | Detail |
|---|---|
| Purpose | Classify and sort threads, suggest categories, compute embeddings, generate user-approved reply drafts |
| Data subjects | Users; third-party correspondents |
| Data categories | Sender, subject, body excerpts of threads (task-scoped payloads); AI outputs (classifications, explanations, draft text, embedding vectors) |
| Recipients | Google (Gemini API, paid tier, no model training on submitted content) |
| Transfers | USA; safeguards per checklist |
| Retention | AI outputs: life of account; nothing retained at provider beyond transient processing per Gemini API terms |

### 4. Transactional and lifecycle email

| Field | Detail |
|---|---|
| Purpose | Verification, password reset, workspace invitations, welcome email, periodic triage-summary lifecycle email (opt-out, one-click unsubscribe) |
| Data subjects | Users; invitees (invited email addresses) |
| Data categories | Recipient address, message content (counts/summaries of the user's own queue; no third-party email bodies) |
| Recipients | Resend |
| Transfers | USA; safeguards per checklist |
| Retention | Not retained by Amarnai beyond send logs without bodies; invitation records until acted on or account deletion |

### 5. Billing and subscriptions

| Field | Detail |
|---|---|
| Purpose | Paid plans, free-trial administration, invoicing, tax |
| Data subjects | Users (workspace owners) |
| Data categories | Stripe customer/subscription/price identifiers; plan state; billing address and tax ID collected and held within Stripe; opaque card fingerprint token (no card numbers stored by Amarnai) |
| Recipients | Stripe |
| Transfers | USA; safeguards per checklist |
| Retention | Life of workspace; on deletion, subscriptions are canceled with a durable retry record until confirmed |

### 6. Anti-abuse and billing-integrity retention (post-deletion)

| Field | Detail |
|---|---|
| Purpose | Prevent repeat free-trial claims and AI-cost refund via account deletion/reset |
| Data subjects | Former users; inbox identities |
| Data categories | SHA-256 hash of normalized email, Stripe card fingerprint token, subscription ID, attribution user ID (`TrialClaim`); plaintext normalized inbox key with usage counters (`InboxUsageMeter`, `InboxBackfillGrant`) |
| Recipients | None (internal only) |
| Transfers | Hosting provider only |
| Retention | Currently unbounded; bounded horizon recommended, TODO(business), see `legitimate-interest-assessment.md` section 5 |
| Legal basis | Art. 6(1)(f); LIA on file |

### 7. Website analytics

| Field | Detail |
|---|---|
| Purpose | Aggregate site usage measurement |
| Data subjects | Site visitors |
| Data categories | Aggregated, anonymous statistics (pages, referrer, browser, OS, device type, approximate country); cookieless; IP addresses not stored |
| Recipients | Self-hosted/EU-hosted Umami instance |
| Transfers | None (EU-hosted) |
| Retention | Aggregate statistics retained indefinitely (anonymous) |

### 8. Support and privacy requests

| Field | Detail |
|---|---|
| Purpose | Handle support questions, privacy rights requests (access, erasure, objection, portability) |
| Data subjects | Users, requesters |
| Data categories | Correspondence content, requester email |
| Recipients | Email provider for the privacy@ / hello@ mailboxes (TODO(business): name it) |
| Transfers | Depends on mailbox provider; TODO(business) |
| Retention | TODO(business): define (suggest 24 months after resolution) |

## Processors summary

Cross-reference: `dpa-transfer-checklist.md` for DPA and transfer-mechanism status per processor: Google (Gemini API), Stripe, Resend, hosting/database provider, privacy mailbox provider. Google (Gmail API) and Microsoft (Graph) act as independent controllers of the source mailboxes; Amarnai accesses them under user OAuth consent.
