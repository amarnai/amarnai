import type { TaxonomyNodeInput, TaxonomyEdgeInput, ThreadMessage } from "../../types.js";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function node(
  id: string,
  name: string,
  description: string | null,
  opts: { isRoot?: boolean; instructions?: string } = {}
): TaxonomyNodeInput {
  return {
    id,
    name,
    description,
    instructions: opts.instructions ?? null,
    examples: [],
    isRoot: opts.isRoot ?? false,
  };
}

function edge(
  id: string,
  sourceNodeId: string,
  targetNodeId: string,
): TaxonomyEdgeInput {
  return { id, sourceNodeId, targetNodeId };
}

// ─── Taxonomy ─────────────────────────────────────────────────────────────────
//
// Inbox [root]
// ├── Sales
// ├── Customer Support
// ├── Legal
// ├── Finance
// ├── HR
// ├── Product Feedback
// ├── Partnerships
// ├── Security
// ├── Operations
// └── Other / Needs Review

export const NODES = {
  inbox: node("inbox", "Inbox", null, { isRoot: true }),

  sales: node(
    "sales",
    "Sales",
    "Outbound sales inquiries, enterprise pricing requests, purchase orders, new business leads, and commercial proposals from prospects."
  ),

  customerSupport: node(
    "customer-support",
    "Customer Support",
    "Technical support request handling, product issue reporting, bug reports, account access problem resolution, and customer help desk ticket processing."
  ),

  legal: node(
    "legal",
    "Legal",
    "Legal document requests, non-disclosure agreements, contract review, compliance inquiries, and regulatory matters."
  ),

  finance: node(
    "finance",
    "Finance",
    "Invoice processing, billing inquiries, payment requests, expense reports, budget approvals, and financial transactions."
  ),

  hr: node(
    "hr",
    "HR",
    "Job application processing, recruitment inquiries, employee onboarding coordination, personnel matters, benefits questions, and hiring processes."
  ),

  productFeedback: node(
    "product-feedback",
    "Product Feedback",
    "Feature requests, product improvement suggestions, user experience feedback, bug reports, and product improvement ideas submitted by customers."
  ),

  partnerships: node(
    "partnerships",
    "Partnerships",
    "Partnership proposals, co-marketing opportunities, integration agreements, co-branding requests, and business collaboration inquiries."
  ),

  security: node(
    "security",
    "Security",
    "Security vulnerability disclosure, incident reporting, penetration testing results, access control issues, and security policy inquiries."
  ),

  operations: node(
    "operations",
    "Operations",
    "Operational logistics coordination, infrastructure management, process workflow requests, resource allocation, and administrative scheduling."
  ),

  otherNeedsReview: node(
    "other-needs-review",
    "Other / Needs Review",
    "Emails that do not clearly fit any defined category and require human review."
  ),
} as const;

export const EDGES = {
  inboxToSales:          edge("e-inbox-sales",          "inbox", "sales"),
  inboxToSupport:        edge("e-inbox-support",        "inbox", "customer-support"),
  inboxToLegal:          edge("e-inbox-legal",          "inbox", "legal"),
  inboxToFinance:        edge("e-inbox-finance",        "inbox", "finance"),
  inboxToHr:             edge("e-inbox-hr",             "inbox", "hr"),
  inboxToProductFeedback:edge("e-inbox-product-feedback","inbox", "product-feedback"),
  inboxToPartnerships:   edge("e-inbox-partnerships",   "inbox", "partnerships"),
  inboxToSecurity:       edge("e-inbox-security",       "inbox", "security"),
  inboxToOperations:     edge("e-inbox-operations",     "inbox", "operations"),
  inboxToOther:          edge("e-inbox-other",          "inbox", "other-needs-review"),
} as const;

export const ALL_NODES: TaxonomyNodeInput[] = Object.values(NODES);
export const ALL_EDGES: TaxonomyEdgeInput[] = Object.values(EDGES);

// ─── Depth-2 taxonomy ─────────────────────────────────────────────────────────
//
// A two-level taxonomy designed to exercise the mid-traversal cross-branch
// LLM escalation path (Step 9 of the sorting algorithm). The thread is clearly
// a customer-support matter but ambiguous between Technical Issues and Billing
// Issues — the two leaf siblings whose raw similarities fall within
// CROSS_BRANCH_MARGIN of each other.
//
// d2-inbox [root]
// ├── d2-customer-support
// │   ├── d2-technical-issues
// │   └── d2-billing-issues
// └── d2-sales

export const NODES_D2 = {
  inbox: node("d2-inbox", "Inbox", null, { isRoot: true }),

  customerSupport: node(
    "d2-customer-support",
    "Customer Support",
    "Customer support requests, issue escalation, account access problems, and technical assistance from existing users."
  ),

  technicalIssues: node(
    "d2-technical-issues",
    "Technical Issues",
    "Technical product defects, bug reports, integration errors, API failures, and system outage notifications."
  ),

  billingIssues: node(
    "d2-billing-issues",
    "Billing Issues",
    "Billing discrepancies, invoice disputes, subscription charge queries, payment failures, and refund requests."
  ),

  sales: node(
    "d2-sales",
    "Sales",
    "Outbound sales inquiries, enterprise pricing requests, new business leads, and commercial proposals from prospects."
  ),
} as const;

export const EDGES_D2 = {
  inboxToSupport: edge("d2-e-inbox-support",     "d2-inbox",            "d2-customer-support"),
  inboxToSales:   edge("d2-e-inbox-sales",        "d2-inbox",            "d2-sales"),
  supportToTech:  edge("d2-e-support-technical",  "d2-customer-support", "d2-technical-issues"),
  supportToBill:  edge("d2-e-support-billing",    "d2-customer-support", "d2-billing-issues"),
} as const;

export const ALL_NODES_D2: TaxonomyNodeInput[] = Object.values(NODES_D2);
export const ALL_EDGES_D2: TaxonomyEdgeInput[] = Object.values(EDGES_D2);

/** An email that is clearly support-related but ambiguous between the two leaf siblings. */
export const D2_AMBIGUOUS_EMAIL: TestEmail = {
  id: "d2-support-tech-or-billing",
  difficulty: "hard",
  messages: [
    {
      subject: "Account issue — unsure if technical or billing",
      senderEmail: "user@example.com",
      senderName: "Platform User",
      bodyText:
        "I am having trouble with my account and I am not sure if it is a technical error or a billing problem. " +
        "The system shows an error when I try to access my dashboard, and I also noticed an unexpected charge on my last invoice. " +
        "Could your support team investigate both and let me know which team is handling this?",
      receivedAt: new Date("2026-01-15T10:00:00Z"),
    },
  ],
  expectedFinalNodeId: NODES_D2.technicalIssues.id,
  allowNeedsHumanReview: true,
};

// ─── Email fixtures ───────────────────────────────────────────────────────────

export type TestEmail = {
  id: string;
  difficulty: "easy" | "medium" | "hard";
  messages: ThreadMessage[];
  expectedFinalNodeId: string;
  /** If true, the LLM returning needsHumanReview is an acceptable result. */
  allowNeedsHumanReview: boolean;
  /**
   * Keywords present in the email body that superficially resemble a different
   * category and could divert a naive classifier from the real intent.
   */
  misleadingKeywords?: string[];
};

const SENT_AT = new Date("2026-01-15T10:00:00Z");

// ─── Depth-3 taxonomy: Personal vs Professional ───────────────────────────────
//
// Tests three-level traversal and cross-branch personal/professional ambiguity.
//
// d3-inbox [root]
// ├── d3-personal
// │   ├── d3-personal-finance
// │   │   ├── d3-subscriptions   (streaming, gym, magazines, personal SaaS)
// │   │   └── d3-banking         (statements, transfers, loans, investments)
// │   └── d3-life-admin
// │       ├── d3-medical         (appointments, prescriptions, personal health insurance)
// │       └── d3-household       (utilities, rent, deliveries, home services)
// └── d3-work
//     ├── d3-work-finance
//     │   ├── d3-expenses        (employee expense reports, reimbursements)
//     │   └── d3-invoices        (vendor invoices, purchase orders, client billing)
//     └── d3-work-people
//         ├── d3-hr              (benefits, payroll, employment admin, employer-provided insurance)
//         └── d3-projects        (task assignments, status updates, deliverables, deadlines)

export const NODES_D3 = {
  inbox: node("d3-inbox", "Inbox", null, { isRoot: true }),

  personal: node(
    "d3-personal",
    "Personal",
    "Personal, non-work emails: personal finances, lifestyle subscriptions, household administration, healthcare, and any email directed at the individual rather than the business."
  ),

  personalFinance: node(
    "d3-personal-finance",
    "Personal Finance",
    "Personal financial emails: bank statements, personal account activity, loan repayments, credit card notices, and investment account updates."
  ),

  subscriptions: node(
    "d3-subscriptions",
    "Subscriptions",
    "Consumer subscription services: streaming platforms, gym memberships, magazine subscriptions, personal software plans, meal kits, and any recurring personal subscription billing."
  ),

  banking: node(
    "d3-banking",
    "Banking",
    "Personal bank account activity: statements, transaction alerts, fund transfers, loan payments, mortgage correspondence, and personal savings or investment account notifications."
  ),

  lifeAdmin: node(
    "d3-life-admin",
    "Life Admin",
    "Personal administrative matters unrelated to finances: healthcare, home management, utilities, deliveries, and other personal logistics."
  ),

  medical: node(
    "d3-medical",
    "Medical",
    "Personal health and medical emails: doctor appointment reminders, prescription notifications, hospital bills, personal health insurance claims not provided through an employer, and medical test results."
  ),

  household: node(
    "d3-household",
    "Household",
    "Home and household administration: utility bills, rent or mortgage statements, home service bookings, delivery notifications, landlord communications, and home maintenance requests."
  ),

  work: node(
    "d3-work",
    "Work",
    "Professional and business emails: work finances, vendor relations, HR matters, project work, and any email related to employment or business operations."
  ),

  workFinance: node(
    "d3-work-finance",
    "Work Finance",
    "Business financial matters: employee expense reports, vendor invoices, purchase orders, client billing, budget approvals, and company financial transactions."
  ),

  expenses: node(
    "d3-expenses",
    "Expenses",
    "Employee expense reports and reimbursements: submitted receipts, approved expense claims, corporate card statements, travel reimbursements, and out-of-pocket business expense submissions."
  ),

  invoices: node(
    "d3-invoices",
    "Invoices",
    "Vendor and supplier invoices, purchase orders, client billing statements, contractor invoices, and payment confirmations for business services or goods."
  ),

  workPeople: node(
    "d3-work-people",
    "Work — People",
    "People and talent matters: HR administration, employee benefits, payroll, recruitment, onboarding, and project coordination."
  ),

  hr: node(
    "d3-hr",
    "HR",
    "Human resources administration: employer-provided benefits enrolment, payroll notifications, employment contracts, onboarding, leave requests, company policy updates, and group insurance plans arranged by the employer."
  ),

  projects: node(
    "d3-projects",
    "Projects",
    "Work project communications: task assignments, project status updates, deadline reminders, deliverable reviews, milestone notifications, and cross-team coordination for ongoing work."
  ),
} as const;

export const EDGES_D3 = {
  // Root → depth 1
  inboxToPersonal:        edge("d3-e-inbox-personal",    "d3-inbox",            "d3-personal"),
  inboxToWork:            edge("d3-e-inbox-work",         "d3-inbox",            "d3-work"),
  // Personal → depth 2
  personalToFinance:      edge("d3-e-personal-finance",   "d3-personal",         "d3-personal-finance"),
  personalToLifeAdmin:    edge("d3-e-personal-lifeadmin", "d3-personal",         "d3-life-admin"),
  // Personal Finance → depth 3
  financeToSubscriptions: edge("d3-e-pf-subscriptions",   "d3-personal-finance", "d3-subscriptions"),
  financeToBanking:       edge("d3-e-pf-banking",         "d3-personal-finance", "d3-banking"),
  // Life Admin → depth 3
  lifeAdminToMedical:     edge("d3-e-la-medical",         "d3-life-admin",       "d3-medical"),
  lifeAdminToHousehold:   edge("d3-e-la-household",       "d3-life-admin",       "d3-household"),
  // Work → depth 2
  workToWorkFinance:      edge("d3-e-work-finance",       "d3-work",             "d3-work-finance"),
  workToWorkPeople:       edge("d3-e-work-people",        "d3-work",             "d3-work-people"),
  // Work Finance → depth 3
  workFinanceToExpenses:  edge("d3-e-wf-expenses",        "d3-work-finance",     "d3-expenses"),
  workFinanceToInvoices:  edge("d3-e-wf-invoices",        "d3-work-finance",     "d3-invoices"),
  // Work People → depth 3
  workPeopleToHr:         edge("d3-e-wp-hr",              "d3-work-people",      "d3-hr"),
  workPeopleToProjects:   edge("d3-e-wp-projects",        "d3-work-people",      "d3-projects"),
} as const;

export const ALL_NODES_D3: TaxonomyNodeInput[] = Object.values(NODES_D3);
export const ALL_EDGES_D3: TaxonomyEdgeInput[] = Object.values(EDGES_D3);

export const TEST_EMAILS_D3: TestEmail[] = [

  // ── Easy: clear unambiguous, no human review ─────────────────────────────────

  {
    id: "d3-netflix-renewal",
    difficulty: "easy",
    messages: [
      {
        subject: "Your Netflix membership — monthly billing confirmation",
        senderEmail: "info@mailer.netflix.com",
        senderName: "Netflix",
        bodyText:
          "Hi, your Netflix membership has been renewed for another month. " +
          "Your card ending in 4812 was charged £15.99 on 14 January 2026. " +
          "Your next billing date is 14 February 2026. " +
          "To manage your plan or cancel your subscription, visit your account settings.",
        receivedAt: SENT_AT,
      },
    ],
    expectedFinalNodeId: NODES_D3.subscriptions.id,
    allowNeedsHumanReview: false,
  },

  {
    id: "d3-vendor-software-invoice",
    difficulty: "easy",
    messages: [
      {
        subject: "Invoice #INV-2026-0342 — annual licence renewal: 15 seats",
        senderEmail: "billing@acme-software.com",
        senderName: "Acme Software Billing",
        bodyText:
          "Please find attached invoice #INV-2026-0342 for your annual software licence renewal. " +
          "15 seats × $240/seat = $3,600.00. Payment terms: net 30. " +
          "Purchase order reference: PO-2026-0891. " +
          "Please arrange payment to the bank details on the invoice. " +
          "Contact billing@acme-software.com with any queries.",
        receivedAt: SENT_AT,
      },
    ],
    expectedFinalNodeId: NODES_D3.invoices.id,
    allowNeedsHumanReview: false,
  },

  // ── Medium: correct routing despite misleading keywords ───────────────────────

  {
    // Clearly a work HR matter (employer-provided benefits enrolment),
    // but saturated with health/medical vocabulary → d3-medical distractor.
    id: "d3-benefits-enrolment",
    difficulty: "medium",
    messages: [
      {
        subject: "Action required: 2026 benefits enrolment closes this Friday",
        senderEmail: "hr@yourcompany.com",
        senderName: "People & HR Team",
        bodyText:
          "Open enrolment for your 2026 employee benefits closes this Friday at 5 pm. " +
          "Please log in to the benefits portal to select your health insurance plan, " +
          "dental and vision coverage, and HSA contribution level for the year. " +
          "Your employer will contribute $400/month toward your medical premium. " +
          "If you take no action, you will be auto-enrolled in last year's plan. " +
          "Contact hr@yourcompany.com with any questions about your coverage options.",
        receivedAt: SENT_AT,
      },
    ],
    expectedFinalNodeId: NODES_D3.hr.id,
    allowNeedsHumanReview: true,
    misleadingKeywords: ["health insurance", "medical", "dental", "coverage", "healthcare"],
  },

  {
    // Expense reimbursement approval — contains invoice/payment/receipt language
    // that could point toward d3-invoices, but the context is employee expenses.
    id: "d3-expense-report-approved",
    difficulty: "medium",
    messages: [
      {
        subject: "Expense report ER-2847 approved — reimbursement processing",
        senderEmail: "expenses@yourcompany.com",
        senderName: "Finance & Expenses",
        bodyText:
          "Your expense report ER-2847 has been approved by your manager. " +
          "Total reimbursement: $347.50. " +
          "Itemised: client dinner (receipt #RCP-0041, $182.00), taxi to airport ($45.50), " +
          "hotel — one night ($120.00). " +
          "Payment will be processed in your next payroll cycle on 31 January. " +
          "Please retain all original receipts for audit purposes.",
        receivedAt: SENT_AT,
      },
    ],
    expectedFinalNodeId: NODES_D3.expenses.id,
    allowNeedsHumanReview: true,
    misleadingKeywords: ["receipt", "payment", "invoice", "billing"],
  },

  {
    // Landlord maintenance request — unambiguously household, but mentions
    // "business premises" and "contractor invoice" as distractors toward
    // d3-work or d3-invoices.
    id: "d3-landlord-maintenance-request",
    difficulty: "medium",
    messages: [
      {
        subject: "Maintenance visit scheduled — boiler inspection, 22 January",
        senderEmail: "maintenance@lettings-agency.com",
        senderName: "Lettings Agency Maintenance Team",
        bodyText:
          "We have scheduled a boiler inspection and annual gas safety check at your property " +
          "for Wednesday 22 January between 9 am and 12 pm. Please ensure access is available. " +
          "Our contractor will issue a service report on completion. " +
          "Note: if the boiler requires parts, a separate contractor invoice will be raised and " +
          "deducted from your deposit in accordance with your tenancy agreement. " +
          "Please confirm receipt of this notice by replying to this email.",
        receivedAt: SENT_AT,
      },
    ],
    expectedFinalNodeId: NODES_D3.household.id,
    allowNeedsHumanReview: true,
    misleadingKeywords: ["contractor invoice", "business premises", "invoice"],
  },

  // ── Hard: genuine cross-branch ambiguity, human review acceptable ─────────────

  {
    // Bank transaction alert where the reference code reveals it is an expense
    // reimbursement being paid into a personal account. The email itself is
    // unambiguously from a personal bank — the "work" signal is only in the
    // reference code. Should route to d3-banking (it's a bank notification),
    // not d3-expenses (which is about submitting/approving expense reports).
    id: "d3-bank-alert-expense-reimbursement",
    difficulty: "hard",
    messages: [
      {
        subject: "Transaction alert: £347.50 received — account ending 3317",
        senderEmail: "alerts@personal-bank.com",
        senderName: "Personal Bank",
        bodyText:
          "A payment of £347.50 has been credited to your current account ending 3317 on 15 January 2026. " +
          "Payment reference: EXP-REIMB-ER2847-JAN26. " +
          "Your updated balance is £1,204.83. " +
          "If you do not recognise this transaction, please contact us immediately.",
        receivedAt: SENT_AT,
      },
    ],
    expectedFinalNodeId: NODES_D3.banking.id,
    allowNeedsHumanReview: true,
    misleadingKeywords: ["EXP-REIMB", "expense", "reimbursement"],
  },

  {
    // A formerly employer-arranged health insurance policy that has been
    // transferred to an individual policy. Mentions employer/group scheme
    // (d3-hr distractor) but the ongoing relationship is now personal.
    id: "d3-individual-health-policy-renewal",
    difficulty: "hard",
    messages: [
      {
        subject: "Your personal health insurance renewal — action required by 31 January",
        senderEmail: "renewals@medicover.com",
        senderName: "Medicover Insurance",
        bodyText:
          "Dear policyholder, your personal health insurance policy #MED-2021-88341 is due for renewal " +
          "on 1 February 2026. Your annual premium will be £1,248 (£104/month). " +
          "This policy was originally arranged through your previous employer's group scheme " +
          "but has been managed as an individual policy since January 2024. " +
          "Please confirm renewal by logging in to your personal Medicover account. " +
          "For questions about your coverage or to add dependants, call our member services team.",
        receivedAt: SENT_AT,
      },
    ],
    expectedFinalNodeId: NODES_D3.medical.id,
    allowNeedsHumanReview: true,
    misleadingKeywords: ["employer", "group scheme", "benefits", "policy"],
  },

  {
    // Same-branch sibling ambiguity: vendor payment confirmation that could be
    // read as an expense settlement. Both d3-expenses and d3-invoices are under
    // d3-work-finance; the distinction is vendor/external (invoices) vs
    // employee/internal (expenses). This email is from an external supplier.
    id: "d3-supplier-payment-confirmation",
    difficulty: "hard",
    messages: [
      {
        subject: "Payment received — ref CONF-2026-03847, balance cleared",
        senderEmail: "accounts@consulting-supplier.com",
        senderName: "Consulting Supplier Accounts",
        bodyText:
          "Dear team, we confirm receipt of your payment of $1,850 against " +
          "our invoice INV-2025-Q4-0047 for consulting services delivered in Q4 2025. " +
          "Your account balance is now $0.00. " +
          "A receipted invoice is attached for your records. " +
          "It has been a pleasure working with your team — we look forward to continuing " +
          "the engagement in 2026.",
        receivedAt: SENT_AT,
      },
    ],
    expectedFinalNodeId: NODES_D3.invoices.id,
    allowNeedsHumanReview: true,
    misleadingKeywords: ["payment", "account balance", "receipt"],
  },
];

// ─── Failure-mode taxonomy ────────────────────────────────────────────────────
//
// A small, DOMAIN-NEUTRAL depth-2 taxonomy that reproduces structural routing
// failures by graph shape and embedding geometry — deliberately NOT modelled on
// any real user's taxonomy, so the benchmark stays general and is not overfit to
// one inbox. These emails are EXPECTED TO FAIL under the current constants; they
// exist to prove the harness catches the failure modes, so a later algorithm fix
// can be measured against them.
//
//   fm-inbox [root]
//   ├── fm-deliveries                   (broad: parcel tracking, dispatch, delivery)
//   │   └── fm-swiftship                (SINGLE child: parcels handled by SwiftShip courier)
//   ├── fm-payments
//   │   ├── fm-card-statements          (monthly card statements, itemised charges)
//   │   └── fm-wallet-topups            (prepaid wallet reloads / balance top-ups)
//   └── fm-community                    (forum digests, community announcements)
//
// Failure 1 — single-child / specific-vendor leaf: fm-deliveries has exactly one
//   child (fm-swiftship), so no sibling can trigger the cross-branch check. A
//   parcel from a DIFFERENT courier descends into fm-swiftship unconditionally
//   instead of staying at the fm-deliveries parent.
// Failure 2 — cross-domain sibling near-tie: a "payment processed" notice is
//   ambiguous between fm-card-statements and fm-wallet-topups; embeddings split
//   inconsistently between the two siblings.
// Failure 3 — off-topic / no-signal: a generic digest matches no node and should
//   hit the quality gate (stay at Inbox / human review), not be force-filed.

export const NODES_FM = {
  inbox: node("fm-inbox", "Inbox", null, { isRoot: true }),

  deliveries: node(
    "fm-deliveries",
    "Deliveries",
    "Parcel and package logistics: dispatch notifications, tracking updates, delivery windows, and proof-of-delivery from any courier or carrier."
  ),

  swiftship: node(
    "fm-swiftship",
    "SwiftShip",
    "Parcels handled specifically by the SwiftShip courier, including SwiftShip-branded dispatch, tracking, and delivery confirmations for shipments carried by SwiftShip."
  ),

  payments: node(
    "fm-payments",
    "Payments",
    "Money movement on the account: charges, statements, balances, and confirmations of completed payment transactions."
  ),

  cardStatements: node(
    "fm-card-statements",
    "Card Statements",
    "Monthly payment-card statements: itemised lists of charges, statement-ready notifications, and minimum-payment-due notices for a credit or debit card."
  ),

  walletTopups: node(
    "fm-wallet-topups",
    "Wallet Top-ups",
    "Prepaid wallet reloads: balance top-up confirmations, auto-reload receipts, and stored-value funding notifications for an in-app wallet."
  ),

  community: node(
    "fm-community",
    "Community",
    "Community forum digests, discussion-thread summaries, and general community announcements unrelated to deliveries or payments."
  ),
} as const;

export const EDGES_FM = {
  inboxToDeliveries:   edge("fm-e-inbox-deliveries",   "fm-inbox",     "fm-deliveries"),
  inboxToPayments:     edge("fm-e-inbox-payments",     "fm-inbox",     "fm-payments"),
  inboxToCommunity:    edge("fm-e-inbox-community",     "fm-inbox",     "fm-community"),
  deliveriesToSwift:   edge("fm-e-deliveries-swift",   "fm-deliveries","fm-swiftship"),
  paymentsToCard:      edge("fm-e-payments-card",       "fm-payments",  "fm-card-statements"),
  paymentsToWallet:    edge("fm-e-payments-wallet",     "fm-payments",  "fm-wallet-topups"),
} as const;

export const ALL_NODES_FM: TaxonomyNodeInput[] = Object.values(NODES_FM);
export const ALL_EDGES_FM: TaxonomyEdgeInput[] = Object.values(EDGES_FM);

export const TEST_EMAILS_FM: TestEmail[] = [
  // Failure 1a — a parcel from a non-SwiftShip courier must stay at the Deliveries
  // parent, NOT descend into the single SwiftShip child. Review is acceptable;
  // landing in the SwiftShip leaf is wrong.
  {
    id: "fm-generic-courier-tracking",
    difficulty: "hard",
    messages: [
      {
        subject: "Your parcel is on its way — tracking RZ4821",
        senderEmail: "tracking@parcelpost.example",
        senderName: "ParcelPost",
        bodyText:
          "Good news — your package has been dispatched and is out for delivery with ParcelPost. " +
          "Estimated delivery is tomorrow between 9am and 1pm. Track your parcel with reference " +
          "RZ4821. No signature is required.",
        receivedAt: SENT_AT,
      },
    ],
    expectedFinalNodeId: NODES_FM.deliveries.id,
    allowNeedsHumanReview: true,
    misleadingKeywords: ["parcel", "tracking", "delivery", "dispatch"],
  },
  // Failure 1b — positive control: a genuinely SwiftShip-carried parcel SHOULD
  // reach the SwiftShip leaf. Distinguishes the bug from "never route to leaf".
  {
    id: "fm-swiftship-dispatch",
    difficulty: "medium",
    messages: [
      {
        subject: "SwiftShip: your shipment SW-99213 has been collected",
        senderEmail: "noreply@swiftship.example",
        senderName: "SwiftShip Courier",
        bodyText:
          "SwiftShip has collected your shipment and it is now moving through the SwiftShip network. " +
          "Your SwiftShip courier will deliver it within two business days. Manage this SwiftShip " +
          "delivery from your SwiftShip dashboard.",
        receivedAt: SENT_AT,
      },
    ],
    expectedFinalNodeId: NODES_FM.swiftship.id,
    allowNeedsHumanReview: false,
  },
  // Failure 2 — cross-domain sibling near-tie: a "payment processed" notice
  // ambiguous between Card Statements and Wallet Top-ups. Either sibling
  // consistently is fine; review is acceptable. Inconsistent splitting is the failure.
  {
    id: "fm-payment-processed-ambiguous",
    difficulty: "hard",
    messages: [
      {
        subject: "Your payment of 20.00 has been processed",
        senderEmail: "no-reply@payments.example",
        senderName: "Payments",
        bodyText:
          "A payment of 20.00 has been processed on your account and your balance has been updated. " +
          "The transaction reference is PMT-55821. You can view the charge and your current balance " +
          "in your account.",
        receivedAt: SENT_AT,
      },
    ],
    expectedFinalNodeId: NODES_FM.cardStatements.id,
    allowNeedsHumanReview: true,
    misleadingKeywords: ["balance", "top-up", "wallet", "reload"],
  },
  // Failure 3 — off-topic / no-signal: matches no node. Should hit the quality
  // gate (stay at Inbox or human review), not be force-filed somewhere.
  {
    id: "fm-offtopic-digest",
    difficulty: "hard",
    messages: [
      {
        subject: "This week in world affairs — your digest",
        senderEmail: "digest@worldaffairs.example",
        senderName: "World Affairs Digest",
        bodyText:
          "This week's digest covers regional developments, diplomatic statements, and analysis of " +
          "ongoing events around the globe. Read the full digest online. You are receiving this " +
          "because you subscribed to our weekly coverage.",
        receivedAt: SENT_AT,
      },
    ],
    expectedFinalNodeId: NODES_FM.inbox.id,
    allowNeedsHumanReview: true,
  },
];

// ─── Origin-constrained taxonomy (Track P: LLM prompt eval) ────────────────────
//
// Exercises the "LLM ignores origin constraints" failure: a node scoped to a
// specific sender/institution, and a confusable email that matches the node's
// THEME but not its ORIGIN, and so must NOT be filed there. Domain-neutral and
// not modelled on any real user taxonomy.
//
//   or-inbox [root]
//   ├── or-orders                       (broad parent)
//   │   ├── or-acme-orders              (origin-constrained: orders ONLY from Acme Store)
//   │   └── or-marketplace-orders       (orders from any other store/marketplace)
//   └── or-newsletters
//
// The discriminator (sender origin) lives ONLY in `instructions`, NOT in the
// thematic descriptions, which are deliberately near-identical. This isolates
// the render-`instructions` fix: the current prompt (which renders description
// but not instructions) cannot tell the two order leaves apart and so cannot
// confidently place an order by its origin; a prompt that renders `instructions`
// can. The cases are scored by the live-LLM reasoning benchmark (cross-branch
// escalation decides them), NOT the embedding grid, which stubs the LLM.

export const NODES_ORIGIN = {
  inbox: node("or-inbox", "Inbox", null, { isRoot: true }),

  orders: node(
    "or-orders",
    "Orders",
    "Online shopping order confirmations, shipping notices, and purchase receipts from any retailer."
  ),

  acmeOrders: node(
    "or-acme-orders",
    "Acme Orders",
    // Thematic only — intentionally indistinguishable from Marketplace Orders by description.
    "Order confirmations, shipping notices, and purchase receipts for online orders.",
    {
      instructions:
        "Only orders from Acme Store (sender at acme-store.example) belong here. " +
        "Orders from any other store or marketplace do NOT belong here.",
    }
  ),

  marketplaceOrders: node(
    "or-marketplace-orders",
    "Marketplace Orders",
    // Thematic only — intentionally indistinguishable from Acme Orders by description.
    "Order confirmations, shipping notices, and purchase receipts for online orders.",
    {
      instructions:
        "Orders from any retailer or marketplace OTHER than Acme Store belong here.",
    }
  ),

  newsletters: node(
    "or-newsletters",
    "Newsletters",
    "Marketing newsletters, promotional digests, and subscription content unrelated to specific orders."
  ),
} as const;

export const EDGES_ORIGIN = {
  inboxToOrders:        edge("or-e-inbox-orders",       "or-inbox",  "or-orders"),
  inboxToNewsletters:   edge("or-e-inbox-newsletters",  "or-inbox",  "or-newsletters"),
  ordersToAcme:         edge("or-e-orders-acme",        "or-orders", "or-acme-orders"),
  ordersToMarketplace:  edge("or-e-orders-marketplace", "or-orders", "or-marketplace-orders"),
} as const;

export const ALL_NODES_ORIGIN: TaxonomyNodeInput[] = Object.values(NODES_ORIGIN);
export const ALL_EDGES_ORIGIN: TaxonomyEdgeInput[] = Object.values(EDGES_ORIGIN);

export const TEST_EMAILS_ORIGIN: TestEmail[] = [
  // Origin violation: a Globex order looks exactly like an Acme order by theme,
  // but its origin is NOT Acme. Must go to Marketplace Orders, never Acme Orders.
  // The current prompt tends to file it under Acme on thematic similarity.
  {
    id: "or-nonacme-order-confirmation",
    difficulty: "hard",
    messages: [
      {
        subject: "Your order #88231 is confirmed",
        senderEmail: "orders@globex-market.example",
        senderName: "Globex Market",
        bodyText:
          "Thanks for shopping with Globex Market! Your order #88231 has been confirmed and a " +
          "receipt is attached. We'll email you again when it ships. View your order details and " +
          "invoice in your Globex Market account.",
        receivedAt: SENT_AT,
      },
    ],
    expectedFinalNodeId: NODES_ORIGIN.marketplaceOrders.id,
    allowNeedsHumanReview: true,
    misleadingKeywords: ["order confirmation", "receipt", "invoice"],
  },
  // Positive control: a genuine Acme order DOES belong in Acme Orders.
  {
    id: "or-acme-order-confirmation",
    difficulty: "medium",
    messages: [
      {
        subject: "Acme Store — your order #5567 is confirmed",
        senderEmail: "orders@acme-store.example",
        senderName: "Acme Store",
        bodyText:
          "Thank you for your purchase from Acme Store. Your order #5567 is confirmed and your " +
          "receipt is attached. We'll notify you when your Acme Store order ships.",
        receivedAt: SENT_AT,
      },
    ],
    expectedFinalNodeId: NODES_ORIGIN.acmeOrders.id,
    allowNeedsHumanReview: false,
  },
];

export const TEST_EMAILS: TestEmail[] = [
  // ── Easy: clear unambiguous matches ──────────────────────────────────────────
  {
    id: "sales-inquiry",
    difficulty: "easy",
    messages: [
      {
        subject: "Enterprise pricing inquiry — commercial licensing request",
        senderEmail: "prospect@example.com",
        senderName: "A Sales Prospect",
        bodyText:
          "We are evaluating enterprise software vendors and would like to request commercial pricing information for your enterprise plan. Our procurement team needs a formal sales quote. Please have a sales representative contact us to discuss enterprise licensing and pricing terms.",
        receivedAt: SENT_AT,
      },
    ],
    expectedFinalNodeId: NODES.sales.id,
    allowNeedsHumanReview: false,
  },
  {
    id: "support-ticket",
    difficulty: "easy",
    messages: [
      {
        subject: "Technical support ticket — account access issue after update",
        senderEmail: "user@example.com",
        senderName: "A Platform User",
        bodyText:
          "We are experiencing a technical issue with our account after the latest platform update. Our users cannot access the dashboard and are getting an error on login. This is blocking our team's daily work. Please open a support ticket and provide a fix or workaround for this account access problem.",
        receivedAt: SENT_AT,
      },
    ],
    expectedFinalNodeId: NODES.customerSupport.id,
    allowNeedsHumanReview: false,
  },
  {
    id: "legal-nda-request",
    difficulty: "easy",
    messages: [
      {
        subject: "NDA request — legal document review and compliance sign-off",
        senderEmail: "legal@vendor.com",
        senderName: "Vendor Legal Team",
        bodyText:
          "Please review the attached non-disclosure agreements before we proceed with our vendor engagement. Our legal team requires signed NDA agreements on file for compliance purposes. The contract includes standard confidentiality clauses and requires your legal sign-off. Please return the signed legal document at your earliest convenience.",
        receivedAt: SENT_AT,
      },
    ],
    expectedFinalNodeId: NODES.legal.id,
    allowNeedsHumanReview: false,
  },
  {
    id: "hr-job-application",
    difficulty: "easy",
    messages: [
      {
        subject: "Job application — Senior Software Engineer, open recruitment",
        senderEmail: "applicant@example.com",
        senderName: "A Job Applicant",
        bodyText:
          "I am applying for the Senior Software Engineer position listed on your careers page. I have attached my resume and cover letter for your review. I would like to discuss the recruitment process and onboarding timeline with your HR department. Please confirm receipt of my job application and advise on next steps in the hiring process.",
        receivedAt: SENT_AT,
      },
    ],
    expectedFinalNodeId: NODES.hr.id,
    allowNeedsHumanReview: false,
  },
  {
    id: "security-vuln-report",
    difficulty: "easy",
    messages: [
      {
        subject: "Security vulnerability disclosure — authentication bypass report",
        senderEmail: "researcher@example.com",
        senderName: "Security Researcher",
        bodyText:
          "We have identified a critical security vulnerability in your authentication system that could allow an unauthorised party to bypass the login process. We are making this security disclosure responsibly as part of our security research. The security incident affects the access control layer and requires immediate attention. Please route this disclosure to your security team for incident response and remediation.",
        receivedAt: SENT_AT,
      },
    ],
    expectedFinalNodeId: NODES.security.id,
    allowNeedsHumanReview: false,
  },
  {
    id: "partnerships-cobrand-proposal",
    difficulty: "easy",
    messages: [
      {
        subject: "Co-branding and integration partnership proposal",
        senderEmail: "partnerships@company.com",
        senderName: "Company Partnerships Team",
        bodyText:
          "We would like to submit several partnership proposals for your review. These include co-marketing opportunities and technology integration agreements. Our co-branding requests cover joint marketing materials and a formal co-marketing collaboration framework. We believe this business collaboration would be mutually beneficial. Please confirm who handles partnerships and co-marketing inquiries at your organisation.",
        receivedAt: SENT_AT,
      },
    ],
    expectedFinalNodeId: NODES.partnerships.id,
    allowNeedsHumanReview: false,
  },

  // ── Medium: correct routing despite misleading keywords ───────────────────────
  {
    id: "finance-invoice-support-distractors",
    difficulty: "medium",
    messages: [
      {
        subject: "Invoice #INV-2024-089 outstanding — billing query",
        senderEmail: "billing@vendor.com",
        senderName: "Vendor Billing Team",
        bodyText:
          "We are writing regarding invoice #INV-2024-089 for $4,200 which remains outstanding on our account. Please process this invoice payment at your earliest convenience to resolve the billing discrepancy. We also need a corrected invoice receipt for our financial records. If there is a billing issue preventing payment, our accounts team is available to help resolve it and provide the necessary financial documentation. Please confirm when the invoice will be processed.",
        receivedAt: SENT_AT,
      },
    ],
    expectedFinalNodeId: NODES.finance.id,
    allowNeedsHumanReview: true,
    misleadingKeywords: ["help", "issue", "accounts"],
  },
  {
    id: "product-feedback-hr-distractors",
    difficulty: "medium",
    messages: [
      {
        subject: "Feature request — bulk user management for team setup",
        senderEmail: "admin@example.com",
        senderName: "A Platform Admin",
        bodyText:
          "I am submitting product improvement suggestions for your platform. Our admin team spends significant time manually setting up user accounts during employee onboarding. We would like a bulk user management feature to streamline account creation. This product improvement idea would save our HR staff considerable time and reduce errors. Please consider this feature request and product feedback for your next roadmap review.",
        receivedAt: SENT_AT,
      },
    ],
    expectedFinalNodeId: NODES.productFeedback.id,
    allowNeedsHumanReview: true,
    misleadingKeywords: ["employee", "onboarding", "hr", "staff"],
  },
  {
    id: "partnerships-sales-distractors",
    difficulty: "medium",
    messages: [
      {
        subject: "Co-marketing partnership proposal — joint campaign opportunity",
        senderEmail: "partnerships@agency.com",
        senderName: "Agency Partnerships",
        bodyText:
          "Dear team, we would like to propose a formal co-marketing partnership between our organisations. Our partnership proposals include co-branded content creation, technology integration agreements, and a joint co-marketing collaboration framework. While the partnership will generate commercial value for both parties, our primary goal is long-term strategic alignment. Please advise on your partnership evaluation process.",
        receivedAt: SENT_AT,
      },
    ],
    expectedFinalNodeId: NODES.partnerships.id,
    allowNeedsHumanReview: true,
    misleadingKeywords: ["commercial"],
  },
  {
    id: "operations-coordination",
    difficulty: "medium",
    messages: [
      {
        subject: "Operational request — logistics coordination and process review",
        senderEmail: "admin@example.com",
        senderName: "Operations Admin",
        bodyText:
          "We need to coordinate several operational logistics tasks and request a brief process review meeting. This is a routine operational workflow matter involving resource allocation and infrastructure coordination. No specific sales inquiry, legal matter, or billing request is involved — this is a general operations request.",
        receivedAt: SENT_AT,
      },
    ],
    expectedFinalNodeId: NODES.operations.id,
    allowNeedsHumanReview: true,
  },

  // ── Hard: clearly off-topic, should stay in Inbox ─────────────────────────────
  {
    id: "unclassifiable-off-topic",
    difficulty: "hard",
    messages: [
      {
        subject: "Question about your parking lot",
        senderEmail: "random@example.com",
        senderName: "Random Sender",
        bodyText:
          "Hello, I noticed there was a car parked in front of your building this morning blocking the entrance. Could you please ask the driver to move it? I was unable to access the street. Thank you.",
        receivedAt: SENT_AT,
      },
    ],
    expectedFinalNodeId: NODES.otherNeedsReview.id,
    allowNeedsHumanReview: true,
  },
];
