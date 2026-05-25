import type { TaxonomyNodeInput, TaxonomyEdgeInput, ThreadMessage } from "../../types.js";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function node(
  id: string,
  name: string,
  description: string | null,
  opts: { isRoot?: boolean } = {}
): TaxonomyNodeInput {
  return {
    id,
    name,
    description,
    instructions: null,
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
