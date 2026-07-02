// Dataset for the Gmail screenshot seed inbox.
//
// Hybrid theme: mostly modern, instantly-legible business email (the kind a
// Chrome Web Store reviewer grasps at a glance), with a couple of subtle Amarna
// nods for brand flavor. Every message is INBOUND (from an external sender to
// the seed inbox), so we never have to fake the user's own Sent mail. Threads
// with two messages are follow-ups from the same sender, which reads naturally
// and exercises Amarnai's "re-sort the whole thread on a new message" behavior.
//
// `category` is a comment for humans only; Amarnai does its own sorting. Times
// are `hoursAgo` from the moment the seeder runs, so the inbox always looks
// fresh. Keep bodies short and plausible. `unread: true` renders bold in Gmail.

/**
 * @typedef {Object} SeedMessage
 * @property {{ name: string, email: string }} from
 * @property {number} hoursAgo
 * @property {boolean} [unread]
 * @property {string} body
 */

/**
 * @typedef {Object} SeedThread
 * @property {string} key       Stable id; also seeds the RFC822 Message-ID.
 * @property {string} subject   First message subject; replies get "Re: ".
 * @property {string} category  Human note only (expected Amarnai folder).
 * @property {SeedMessage[]} messages  Oldest first.
 */

/** @type {SeedThread[]} */
export const THREADS = [
  // ── Customers → Billing ─────────────────────────────────────────────────────
  {
    key: "stripe-receipt",
    subject: "Your receipt from Amarnai [#2843-1190]",
    category: "Customers / Billing",
    messages: [
      {
        from: { name: "Stripe", email: "receipts@stripe.com" },
        hoursAgo: 30,
        unread: false,
        body:
          "Thanks for your payment. Your receipt for the Amarnai Pro plan is attached.\n\nAmount paid: $49.00\nCard: Visa ****4242\n\nView receipt in your Stripe dashboard.\n\n— Stripe",
      },
    ],
  },
  {
    key: "invoice-overdue",
    subject: "Invoice 0043 is 12 days overdue",
    category: "Customers / Billing",
    messages: [
      {
        from: { name: "Nadia Okonkwo", email: "nadia@brightloom.io" },
        hoursAgo: 27,
        unread: true,
        body:
          "Hi there,\n\nWe still haven't seen payment on invoice 0043 ($1,200), now 12 days past due. Could you let me know when we can expect it? Happy to resend the invoice if it got lost.\n\nThanks,\nNadia\nFinance, Brightloom",
      },
      {
        from: { name: "Nadia Okonkwo", email: "nadia@brightloom.io" },
        hoursAgo: 3,
        unread: true,
        body:
          "Following up on this — we'd like to get it cleared before month end. Let me know if there's a problem on our side.\n\nNadia",
      },
    ],
  },
  {
    key: "card-declined",
    subject: "Action needed: your payment method was declined",
    category: "Customers / Billing",
    messages: [
      {
        from: { name: "Amarnai Billing", email: "billing@amarnai.app" },
        hoursAgo: 52,
        unread: false,
        body:
          "We tried to charge your card for this month's subscription and it was declined. Please update your payment method to avoid interruption. We'll retry in 3 days.",
      },
    ],
  },

  // ── Customers → Support ─────────────────────────────────────────────────────
  {
    key: "bug-export",
    subject: "CSV export is missing the last column",
    category: "Customers / Support",
    messages: [
      {
        from: { name: "Tomás Herrera", email: "tomas@finchpeak.co" },
        hoursAgo: 20,
        unread: true,
        body:
          "Hey team,\n\nWhen I export my contacts to CSV the final column (\"tags\") comes through empty every time, even though the tags show fine in the app. Chrome on macOS. Can you take a look?\n\nCheers,\nTomás",
      },
      {
        from: { name: "Tomás Herrera", email: "tomas@finchpeak.co" },
        hoursAgo: 5,
        unread: true,
        body:
          "Update: it also happens in Firefox, so probably not browser-specific. Let me know if you need a sample file.",
      },
    ],
  },
  {
    key: "feature-request",
    subject: "Feature request: keyboard shortcuts",
    category: "Customers / Support",
    messages: [
      {
        from: { name: "Priya Balan", email: "priya@meridian-labs.com" },
        hoursAgo: 44,
        unread: false,
        body:
          "Love the product. One thing that would make it perfect: keyboard shortcuts for archiving and moving between folders. Any plans for that?\n\n— Priya",
      },
    ],
  },
  {
    key: "onboarding-help",
    subject: "Can't connect my second mailbox",
    category: "Customers / Support",
    messages: [
      {
        from: { name: "Derek Sullivan", email: "derek@northgate.partners" },
        hoursAgo: 8,
        unread: true,
        body:
          "I connected my main Gmail fine but when I try to add a second one it just spins on the consent screen. Am I missing something? Screenshot attached.",
      },
    ],
  },

  // ── Investors ───────────────────────────────────────────────────────────────
  {
    key: "investor-checkin",
    subject: "Checking in before the board meeting",
    category: "Investors",
    messages: [
      {
        from: { name: "Helen Vasquez", email: "helen@seedstage.vc" },
        hoursAgo: 16,
        unread: true,
        body:
          "Hi,\n\nAhead of next week's board meeting, could you send over the latest metrics deck and the updated runway model? Want to make sure we're aligned on the raise timeline.\n\nBest,\nHelen\nSeedstage Ventures",
      },
    ],
  },
  {
    key: "investor-intro",
    subject: "Intro to Marcus at Latitude?",
    category: "Investors",
    messages: [
      {
        from: { name: "Ravi Deshmukh", email: "ravi@anglecapital.com" },
        hoursAgo: 40,
        unread: false,
        body:
          "Enjoyed our call. I think Marcus at Latitude would be a great fit for your round — he's led two email-adjacent deals. Want me to make the intro? Just say the word.\n\nRavi",
      },
    ],
  },
  {
    key: "monthly-update",
    subject: "Re: Amarnai — May investor update",
    category: "Investors",
    messages: [
      {
        from: { name: "James Whitfield", email: "james@harbourfund.com" },
        hoursAgo: 62,
        unread: false,
        body:
          "Great numbers this month, congrats on crossing 2k active workspaces. The churn dip is encouraging. Happy to help on the enterprise intros whenever you're ready.\n\nJames",
      },
    ],
  },

  // ── Hiring ──────────────────────────────────────────────────────────────────
  {
    key: "greenhouse-app",
    subject: "New application: Senior Backend Engineer",
    category: "Hiring",
    messages: [
      {
        from: { name: "Greenhouse", email: "no-reply@greenhouse.io" },
        hoursAgo: 12,
        unread: true,
        body:
          "A new candidate has applied for Senior Backend Engineer.\n\nCandidate: Amina Farah\nSource: LinkedIn\nResume and screening answers are attached in Greenhouse.\n\nReview application →",
      },
    ],
  },
  {
    key: "recruiter-outreach",
    subject: "Two strong eng candidates for you",
    category: "Hiring",
    messages: [
      {
        from: { name: "Claire Dubois", email: "claire@talentbridge.io" },
        hoursAgo: 36,
        unread: false,
        body:
          "Hi,\n\nI have two backend engineers wrapping up at a well-known startup who'd be a great fit for your team. Both open to seed-stage. Can I send over their profiles?\n\nClaire\nTalentBridge",
      },
    ],
  },
  {
    key: "interview-scheduling",
    subject: "Availability for a final-round interview",
    category: "Hiring",
    messages: [
      {
        from: { name: "Kenji Watanabe", email: "kenji.watanabe@gmail.com" },
        hoursAgo: 22,
        unread: true,
        body:
          "Thanks for moving me forward! I'm free Tuesday afternoon or Thursday morning next week for the final round. Let me know what works and I'll block it off.\n\nKenji",
      },
      {
        from: { name: "Kenji Watanabe", email: "kenji.watanabe@gmail.com" },
        hoursAgo: 2,
        unread: true,
        body:
          "Quick nudge — happy to be flexible if neither slot works on your end.",
      },
    ],
  },

  // ── Newsletters / Other ─────────────────────────────────────────────────────
  {
    key: "newsletter-tldr",
    subject: "TLDR: OpenAI ships, a new Rust web framework, and more",
    category: "Other / Newsletters",
    messages: [
      {
        from: { name: "TLDR Newsletter", email: "dan@tldrnewsletter.com" },
        hoursAgo: 33,
        unread: false,
        body:
          "Today's top stories in tech and startups, summarized in 5 minutes.\n\n• A major model release lands\n• A fast new Rust web framework\n• The state of AI agents in 2026\n\nRead online · Unsubscribe",
      },
    ],
  },
  {
    key: "newsletter-lenny",
    subject: "How the best PMs run their inbox",
    category: "Other / Newsletters",
    messages: [
      {
        from: { name: "Lenny's Newsletter", email: "lenny@substack.com" },
        hoursAgo: 70,
        unread: false,
        body:
          "This week: a deep dive on inbox management systems used by top product leaders, plus a template you can copy.\n\nRead in the app · Manage subscription",
      },
    ],
  },
  {
    key: "calendar-invite",
    subject: "Invitation: Product sync @ Thu 2:00pm",
    category: "Other",
    messages: [
      {
        from: { name: "Google Calendar", email: "calendar-notification@google.com" },
        hoursAgo: 6,
        unread: true,
        body:
          "You have been invited to the following event.\n\nProduct sync\nThursday, 2:00 – 2:30pm\nGoogle Meet link included\n\nYes · Maybe · No",
      },
    ],
  },
  {
    key: "shipping-notice",
    subject: "Your order has shipped",
    category: "Other",
    messages: [
      {
        from: { name: "Rume Standing Desks", email: "orders@rume.com" },
        hoursAgo: 48,
        unread: false,
        body:
          "Good news — your order #RM-88213 is on its way and should arrive in 2–3 business days. Track your package any time.",
      },
    ],
  },

  // ── Amarna nods (subtle brand flavor) ───────────────────────────────────────
  {
    key: "aziru-alliance",
    subject: "Alliance proposal for our two houses",
    category: "Other (personal)",
    messages: [
      {
        from: { name: "Aziru", email: "aziru@amurru.co" },
        hoursAgo: 18,
        unread: true,
        body:
          "For many years our houses have worked as brothers. I write to propose we formalize the partnership properly — a proper contract, signed. Free to talk this week?\n\n— Aziru, Amurru",
      },
    ],
  },
  {
    key: "tushratta-council",
    subject: "Prepare the eastern figures before the council",
    category: "Investors (personal)",
    messages: [
      {
        from: { name: "Tushratta", email: "tushratta@mitanni.int" },
        hoursAgo: 58,
        unread: false,
        body:
          "The council convenes at the start of the quarter. Please prepare a full accounting of the eastern territories and send it ahead by courier so there are no surprises.\n\nTushratta",
      },
    ],
  },
];
