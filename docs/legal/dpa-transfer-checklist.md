# DPA and International Transfer Verification Checklist

| | |
|---|---|
| **Purpose** | Verify Article 28 data processing agreements and Chapter V transfer safeguards for every processor of the hosted service |
| **Version / date** | 0.1 / 2026-07-16, draft |
| **Owner** | TODO(business) |

The privacy policy (revision of July 16, 2026) uses deliberately disjunctive transfer wording: providers are "certified under the EU-US Data Privacy Framework ... or bound by Standard Contractual Clauses". This stays true under either mechanism, but each vendor's actual status must be verified below, and the policy revisited once verified.

## Vendor checklist

Columns: DPA in place? / Transfer mechanism (DPF or SCCs) / Verified date / Evidence (link or file) / Owner.

| Vendor | Role | DPA in place? | Transfer mechanism | Verified | Evidence | Owner |
|---|---|---|---|---|---|---|
| Google: Gemini API | Processor (AI classification, embeddings, drafts) | TODO: accept/verify the Google Cloud Data Processing Addendum covering the Gemini API paid tier | TODO: check Google LLC's EU-US DPF certification (dataprivacyframework.gov) incl. UK and Swiss extensions | | | |
| Google: Gmail API / OAuth | Independent controller of the source mailbox; Amarnai accesses under user consent | N/A (controller-to-controller via user consent; Limited Use policy applies) | N/A for Amarnai's access; user-directed | | CASA Tier 2 cleared July 2026 | |
| Microsoft: Graph API (Outlook) | Independent controller of the source mailbox | N/A (same model as Gmail) | N/A; user-directed | | | |
| Stripe | Processor (billing) | TODO: confirm the Stripe DPA is incorporated in the Stripe Services Agreement (it is by default; capture evidence) | TODO: verify Stripe, Inc. DPF certification status | | | |
| Resend | Processor (transactional email) | TODO: sign or verify Resend's DPA | TODO: verify Resend DPF status; if not certified, execute SCCs (module 2) | | | |
| Hosting / PostgreSQL / Redis provider | Processor (infrastructure) | TODO(business): identify the production provider and region, then verify its DPA | TODO: prefer an EU region for the database; if US, verify DPF/SCCs | | | |
| Privacy/support mailbox provider (privacy@, hello@) | Processor (correspondence) | TODO(business): identify provider, verify DPA | TODO | | | |
| Umami analytics host | Processor if managed / N/A if self-hosted | TODO(business): confirm self-hosted vs Umami Cloud EU | EU-hosted per privacy policy; capture evidence | | | |

## Verification tasks beyond DPAs

- [ ] **Gemini paid tier**: confirm the production `FRONTIER_LLM_*` and embedding API keys are attached to a billed Google account/project. The privacy policy's claim that "Google does not use submitted content to train or improve its models" depends on the paid tier. Capture a screenshot/evidence of the billing state. Owner: TODO. **Blocker for policy accuracy.**
- [ ] **Article 27 EU representative**: the controller is US-established (Wyoming) and offers services to EU users, so an EU representative must be appointed and named in the privacy policy. Evaluate providers (e.g. DataRep, VeraSafe, IITR). Likely also a **UK representative** under UK GDPR. Owner: TODO(business). Target date: before hosted EU marketing push.
- [ ] **Policy reconciliation**: once the table above is verified, update the International Data Transfers section of the privacy policy if any vendor relies solely on SCCs, and add the EU/UK representative's identity and contact details.
- [ ] **Annual re-verification**: DPF certifications lapse and vendors change terms; re-run this checklist yearly and on vendor change. Add to the DPIA review cadence.
- [ ] **Sub-processor list**: consider publishing a public sub-processor page (common SaaS practice, simplifies Art. 13/14 recipient disclosure). Owner: TODO(business).
