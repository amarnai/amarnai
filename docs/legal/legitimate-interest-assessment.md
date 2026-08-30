# Legitimate Interest Assessment: post-deletion anti-abuse records

| | |
|---|---|
| **Processing assessed** | Retention of anti-abuse and billing-integrity records after account deletion |
| **Lawful basis claimed** | Article 6(1)(f) GDPR (legitimate interests) |
| **Version** | 0.1 |
| **Date** | 2026-07-16 |
| **Status** | Draft, pending counsel review |

## 1. The processing, precisely

When a user deletes their Aziru account, `deleteUserCascade` (`packages/db/src/workspace-ops.ts`) permanently deletes all account data. By design, the following records have no foreign key to `User` or `Workspace` and survive deletion (`packages/db/prisma/schema.prisma`):

1. **`TrialClaim`**: records that an email identity (and optionally a payment card) has consumed the single 14-day free trial. Fields: `emailKeyHash` (SHA-256 of the normalized email address; the raw email is never stored), `cardFingerprint` (an opaque, nullable-unique token issued by Stripe; not a card number), `stripeSubscriptionId` (nullable), `userId` (attribution-only plain string), `createdAt`. Deletion actively **writes** a claim before removing the user, so that re-registering the same email cannot mint a fresh trial.
2. **`InboxUsageMeter`**: pooled per-inbox AI-cost counters. Fields: `inboxKey` (the normalized inbox address, stored in plaintext), meter kind, monthly window start, a monotonic `used` counter, and backfill grace flags. Exists so that a workspace reset or delete-and-recreate cannot refund already-spent LLM cost.
3. **`InboxBackfillGrant`**: records that a workspace already received its one-time free historical import of an inbox. Fields: `inboxKey` (plaintext normalized address), `workspaceId` (plain string), `freeConsumed`, `grantedAt`.
4. **`IdempotencyMarker`**: dedup tokens for retried background jobs. Tokens are composed of internal identifiers (thread IDs, job IDs, window keys), not directly identifying data; pruned after 90 days.
5. **`PendingSubscriptionCancellation`**: a transient retry record ensuring a deleted account's Stripe subscription is actually canceled; deleted by the worker once Stripe confirms. This record protects the deleted user (it stops billing) and is short-lived; it is noted here for completeness but not further assessed.

Personal data involved after deletion is therefore limited to: a one-way email hash, a Stripe card fingerprint token, plaintext normalized inbox addresses on usage/grant rows, and attribution-only identifier strings. No names, no email content, no profile data.

## 2. Purpose test

**Interest pursued**: preventing financial abuse of the service. Two concrete, documented attack patterns motivated these records:

- Free-trial farming: delete the account (or use a fresh email variant) and re-register to claim unlimited 14-day trials, each carrying real AI and infrastructure cost.
- Cost refund by reset: workspace reset or account deletion previously wiped the rows that usage quotas counted, effectively refunding already-spent LLM cost and enabling unlimited free processing of the same inbox.

This is a legitimate, real, and present interest of the controller (protection against fraud and abuse is expressly recognized in Recital 47 GDPR). It also protects paying users, whose fees would otherwise subsidize abuse.

## 3. Necessity test

- **Could consent work?** No. An abuser would simply refuse or withdraw consent; the record is only effective if it survives the account relationship.
- **Could the record be deleted with the account?** No. Deletion is precisely the abuse vector; a record erased on deletion cannot prevent delete-and-retry abuse.
- **Is less data possible?**
  - `TrialClaim` is already minimized: one-way hash, opaque fingerprint token. The retained `userId` and `stripeSubscriptionId` are attribution/audit conveniences rather than strictly necessary for enforcement. TODO(engineering decision): consider dropping them from the surviving record (noted as deferred hardening; out of scope of the current change).
  - `InboxUsageMeter.inboxKey` and `InboxBackfillGrant.inboxKey` store the normalized inbox address in **plaintext**. Enforcement only requires equality matching, which a keyed hash would also satisfy. TODO(engineering decision): evaluate hashing `inboxKey` (migration cost: rehash on write path and backfill existing rows). Until then, this LIA covers the plaintext form and the balancing test below accounts for it.
- **Proportionate scope**: the records contain counters and identity keys only; they cannot reconstruct email content, cannot be used to contact the person, and are not used for any purpose other than trial/quota enforcement.

## 4. Balancing test

- **Nature of the data**: low sensitivity. An email hash and a card fingerprint token are pseudonymous; the plaintext inbox key is an email address but is stored without any linked content, name, or activity beyond aggregate counters.
- **Reasonable expectations**: a person who deletes an account expects their content and profile gone (which happens). Anti-fraud residue is a widely established industry practice and is now expressly disclosed in the privacy policy (Data Retention section, July 16, 2026 revision), which strengthens the expectation argument.
- **Impact on the data subject**: negligible. The records trigger no communications, no decisions about the person other than trial/quota eligibility on a future signup, and are inaccessible to other users.
- **Objection handling (Article 21)**: objections via privacy@aziru.email are assessed individually; the compelling-grounds override (fraud prevention) is expected to apply in the typical case, but each objection must be genuinely reviewed. TODO(business): add this to the support runbook.
- **Outcome**: the controller's interest prevails; the residual privacy impact is minimal and disclosed.

## 5. Retention of the surviving records themselves

Indefinite retention is the hardest position to defend under Article 5(1)(e). Recommendation: define a fixed horizon after which anti-abuse value has decayed, e.g. delete `TrialClaim` rows N years after `createdAt` and inbox meters/grants N months after their window closes. TODO(business): set N and implement a scheduled prune, mirroring the existing 90-day `pruneIdempotencyMarkers` pattern (`packages/db/src/usage-meter.ts`).

## 6. Conclusion

Retention of `TrialClaim`, `InboxUsageMeter`, and `InboxBackfillGrant` past account deletion is justified under Article 6(1)(f), subject to: (a) the disclosure now present in the privacy policy, (b) genuine case-by-case handling of Article 21 objections, and (c) adoption of a bounded retention period per section 5.

Sign-off: TODO(business): name, role, date.
