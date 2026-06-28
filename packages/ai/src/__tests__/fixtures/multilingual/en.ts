// English multilingual-benchmark threads (source locale).
import type { TestEmail } from "../sorting-fixtures.js";

const SENT_AT = new Date("2026-01-15T10:00:00Z");

export const THREADS_EN_FLAT: TestEmail[] = [
  {
    id: "en-finance-clear",
    difficulty: "easy",
    messages: [
      {
        subject: "Invoice INV-2026-1180 due in 7 days",
        senderEmail: "billing@northwind-supplies.com",
        senderName: "Northwind Supplies Billing",
        bodyText:
          "Hello, this is a reminder that invoice INV-2026-1180 for $2,940.00 is due on 22 January 2026. " +
          "Please confirm the payment date and let us know if you need the bank details again.",
        receivedAt: SENT_AT,
      },
    ],
    expectedFinalNodeId: "finance",
    allowNeedsHumanReview: true,
    split: "tune",
  },
  {
    id: "en-sales-quoted",
    difficulty: "medium",
    messages: [
      {
        subject: "Re: Enterprise pricing for 80 seats",
        senderEmail: "procurement@brightwave.io",
        senderName: "Brightwave Procurement",
        bodyText:
          "Following up: we would like a formal quote for 80 enterprise seats with annual billing and volume discounts.\n\n" +
          "On Mon, 12 Jan 2026 at 09:30, Sales Team <sales@example.com> wrote:\n" +
          "> Thanks for your interest. How many users should the proposal cover?\n" +
          "> Best regards, the sales team",
        receivedAt: SENT_AT,
      },
    ],
    expectedFinalNodeId: "sales",
    allowNeedsHumanReview: true,
    split: "tune",
  },
  {
    id: "en-support-unquoted",
    difficulty: "medium",
    messages: [
      {
        subject: "Re: Export keeps failing",
        senderEmail: "dana@acme-corp.com",
        senderName: "Dana Whitfield",
        bodyText:
          "I tried the steps you sent but the app still crashes every time I export a report to PDF after the 3.2 update. Could you escalate this?\n\n" +
          "On Thu, 8 Jan 2026 at 14:10, Support <support@example.com> wrote:\n" +
          "Thanks for reaching out. Please try reinstalling the latest update and let us know if the problem persists.",
        receivedAt: SENT_AT,
      },
    ],
    expectedFinalNodeId: "customer-support",
    allowNeedsHumanReview: true,
    split: "tune",
  },
  {
    id: "en-partnerships-sales-ambiguous",
    difficulty: "hard",
    messages: [
      {
        subject: "Reseller arrangement and volume pricing",
        senderEmail: "alex@channelpartners.co",
        senderName: "Alex Romano",
        bodyText:
          "We'd like to resell your product to our customers and would need wholesale pricing tiers. " +
          "This could be a co-marketing relationship, but our immediate need is a commercial agreement and a price list. " +
          "Can we set up a call to discuss terms?",
        receivedAt: SENT_AT,
      },
    ],
    expectedFinalNodeId: "partnerships",
    allowNeedsHumanReview: true,
    misleadingKeywords: ["pricing", "wholesale", "price list", "commercial agreement"],
    split: "holdout",
  },
  {
    id: "en-legal-second",
    difficulty: "easy",
    messages: [
      {
        subject: "Mutual NDA for evaluation",
        senderEmail: "counsel@meridianlaw.com",
        senderName: "Meridian Legal",
        bodyText:
          "Please find our standard mutual non-disclosure agreement for review ahead of the technical evaluation. " +
          "Let us know if your legal team has any redlines before signature.",
        receivedAt: SENT_AT,
      },
    ],
    expectedFinalNodeId: "legal",
    allowNeedsHumanReview: true,
    split: "holdout",
  },
  {
    id: "en-security-clear",
    difficulty: "easy",
    messages: [
      {
        subject: "Vulnerability report: reflected XSS in search",
        senderEmail: "research@redcell-security.com",
        senderName: "Red Cell Research",
        bodyText:
          "We identified a reflected cross-site scripting vulnerability in your search endpoint. " +
          "Steps to reproduce and a proof of concept are attached. Please confirm receipt so we can coordinate disclosure.",
        receivedAt: SENT_AT,
        attachmentNames: ["poc.txt"],
      },
    ],
    expectedFinalNodeId: "security",
    allowNeedsHumanReview: true,
    split: "tune",
  },
  {
    id: "en-operations-clear",
    difficulty: "medium",
    messages: [
      {
        subject: "Warehouse slot scheduling for next week",
        senderEmail: "ops@harbor-logistics.com",
        senderName: "Harbor Logistics Ops",
        bodyText:
          "We need to coordinate dock scheduling and resource allocation for next week's inbound shipments. " +
          "Please confirm the available loading slots so we can finalize the workflow.",
        receivedAt: SENT_AT,
      },
    ],
    expectedFinalNodeId: "operations",
    allowNeedsHumanReview: true,
    split: "holdout",
  },
  {
    id: "en-product-feedback-clear",
    difficulty: "medium",
    messages: [
      {
        subject: "Feature request: bulk re-categorize",
        senderEmail: "maya@designhub.app",
        senderName: "Maya Patel",
        bodyText:
          "Love the product. One suggestion: it would be great to select many threads and re-categorize them in one action. " +
          "The current one-at-a-time flow is slow for large inboxes. This would really improve the experience.",
        receivedAt: SENT_AT,
      },
    ],
    expectedFinalNodeId: "product-feedback",
    allowNeedsHumanReview: true,
    split: "tune",
  },
];

export const THREADS_EN_D3: TestEmail[] = [
  {
    id: "en-d3-expenses",
    difficulty: "medium",
    messages: [
      {
        subject: "Expense reimbursement for the Berlin trip",
        senderEmail: "finance@yourcompany.com",
        senderName: "Finance Team",
        bodyText:
          "Your expense report for the Berlin trip has been approved. The reimbursement of $612.40 for flights, hotel, and meals " +
          "will be paid with your next payroll run. The submitted receipts are on file.",
        receivedAt: SENT_AT,
      },
    ],
    expectedFinalNodeId: "d3-expenses",
    allowNeedsHumanReview: true,
    split: "tune",
  },
  {
    id: "en-d3-banking",
    difficulty: "medium",
    messages: [
      {
        subject: "Your January account statement is ready",
        senderEmail: "alerts@meridian-bank.com",
        senderName: "Meridian Bank",
        bodyText:
          "Your personal current account statement for January is now available. " +
          "Your closing balance and recent transactions, including a transfer and a direct debit, can be viewed in online banking.",
        receivedAt: SENT_AT,
      },
    ],
    expectedFinalNodeId: "d3-banking",
    allowNeedsHumanReview: true,
    split: "holdout",
  },
];
