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
// ├── Weddings
// ├── Funerals
// ├── Conferences / invitations
// ├── Media / interviews
// ├── General secretariat
// ├── Editorial / pitches
// ├── Contributors
// ├── Subscriptions / distribution
// ├── Partnerships / press
// └── Other / needs review

export const NODES = {
  inbox: node("inbox", "Inbox", null, { isRoot: true }),

  weddings: node(
    "weddings",
    "Weddings",
    "Wedding ceremony requests, planning inquiries, venue coordination, and marriage-related logistics."
  ),

  funerals: node(
    "funerals",
    "Funerals",
    "Funeral service inquiries, bereavement coordination, memorial ceremony requests, and related administrative matters."
  ),

  conferencesInvitations: node(
    "conferences-invitations",
    "Conferences / invitations",
    "Conference speaking invitations, seminar bookings, public lectures, panel participation, and professional event requests."
  ),

  mediaInterviews: node(
    "media-interviews",
    "Media / interviews",
    "Press interview requests, media appearances, journalist inquiries, and TV or radio segment invitations."
  ),

  generalSecretariat: node(
    "general-secretariat",
    "General secretariat",
    "Administrative requests that do not fit ceremonies or bookings: scheduling, correspondence, and general coordination."
  ),

  editorialPitches: node(
    "editorial-pitches",
    "Editorial / pitches",
    "New article pitch and editorial proposals from writers who want to be published in Tenoua for the first time or submit a specific piece."
  ),

  contributors: node(
    "contributors",
    "Contributors",
    "Correspondence from established regular contributors, columnists, and staff writers who already write for Tenoua on an ongoing basis."
  ),

  subscriptionsDistribution: node(
    "subscriptions-distribution",
    "Subscriptions / distribution",
    "Subscription sign-ups, renewals, and cancellations for readers who want to receive or stop receiving Tenoua. Also covers distribution logistics and reader services."
  ),

  partnershipsPress: node(
    "partnerships-press",
    "Partnerships / press",
    "Partnership proposals, sponsorship inquiries, co-branding opportunities, and press relations for Tenoua."
  ),

  otherNeedsReview: node(
    "other-needs-review",
    "Other / needs review",
    "Emails that do not clearly fit any defined category and require human review."
  ),
} as const;

export const EDGES = {
  inboxToWeddings: edge("e-inbox-weddings", "inbox", "weddings"),
  inboxToFunerals: edge("e-inbox-funerals", "inbox", "funerals"),
  inboxToConferences: edge("e-inbox-conf", "inbox", "conferences-invitations"),
  inboxToMedia: edge("e-inbox-media", "inbox", "media-interviews"),
  inboxToGeneral: edge("e-inbox-general", "inbox", "general-secretariat"),
  inboxToEditorial: edge("e-inbox-editorial", "inbox", "editorial-pitches"),
  inboxToContributors: edge("e-inbox-contributors", "inbox", "contributors"),
  inboxToSubscriptions: edge("e-inbox-subs", "inbox", "subscriptions-distribution"),
  inboxToPartnerships: edge("e-inbox-partnerships", "inbox", "partnerships-press"),
  inboxToOther: edge("e-inbox-other", "inbox", "other-needs-review"),
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
  {
    id: "wedding-ceremony",
    difficulty: "easy",
    messages: [
      {
        subject: "Wedding ceremony coordination — venue and date request",
        senderEmail: "couple@example.com",
        senderName: "Sophie and David",
        bodyText:
          "We are planning our wedding ceremony for next spring and would like to discuss venue availability and booking a date. Please let us know the process for wedding coordination.",
        receivedAt: SENT_AT,
      },
    ],
    expectedFinalNodeId: NODES.weddings.id,
    allowNeedsHumanReview: false,
  },
  {
    id: "funeral-service",
    difficulty: "easy",
    messages: [
      {
        subject: "Funeral service arrangement — bereavement support",
        senderEmail: "family@example.com",
        senderName: "Cohen Family",
        bodyText:
          "We are writing to arrange a funeral service following a bereavement in our family. We need guidance on memorial ceremony options and the administrative process. Thank you.",
        receivedAt: SENT_AT,
      },
    ],
    expectedFinalNodeId: NODES.funerals.id,
    allowNeedsHumanReview: false,
  },
  {
    id: "conference-booking",
    difficulty: "easy",
    messages: [
      {
        subject: "Conference keynote request — Annual Leadership Symposium",
        senderEmail: "events@conference.org",
        senderName: "Conference Organiser",
        bodyText:
          "We are organising an annual leadership conference and would like to book you as a keynote speaker. The two-day seminar and panel program takes place in Paris in October. Please advise on your speaker fee and schedule.",
        receivedAt: SENT_AT,
      },
    ],
    expectedFinalNodeId: NODES.conferencesInvitations.id,
    allowNeedsHumanReview: false,
  },
  {
    id: "media-interview-request",
    difficulty: "easy",
    messages: [
      {
        subject: "Journalist interview request — media appearance for documentary",
        senderEmail: "journalist@broadcast.org",
        senderName: "A Journalist",
        bodyText:
          "I am a journalist working on a television documentary and would like to request a media interview. Please let me know your availability for this interview appearance. This is a journalist inquiry — no written article is involved.",
        receivedAt: SENT_AT,
      },
    ],
    expectedFinalNodeId: NODES.mediaInterviews.id,
    allowNeedsHumanReview: false,
  },
  {
    id: "tenoua-subscription-mourning-distractors",
    difficulty: "medium",
    messages: [
      {
        subject: "Tenoua subscription renewal — mourning ceremonies coverage feedback",
        senderEmail: "reader@example.com",
        senderName: "A Reader",
        bodyText:
          "I would like to renew my subscription to Tenoua. Your distribution of the last issue was prompt. I appreciated the coverage of mourning rituals and funeral ceremonies. Please process my subscription renewal.",
        receivedAt: SENT_AT,
      },
    ],
    expectedFinalNodeId: NODES.subscriptionsDistribution.id,
    allowNeedsHumanReview: true,
    misleadingKeywords: ["mourning", "funeral", "ceremonies"],
  },
  {
    id: "tenoua-editorial-funeral-distractors",
    difficulty: "medium",
    messages: [
      {
        subject: "Article pitch for Tenoua — mourning rituals in Jewish communities",
        senderEmail: "writer@example.com",
        senderName: "A Writer",
        bodyText:
          "Dear editors, I am pitching an article for Tenoua on contemporary Jewish mourning rituals and funeral practices. I have an editorial draft of 1500 words ready for your editorial review. The piece explores how mourning ceremonies have evolved. Please advise if this article pitch fits your publication schedule.",
        receivedAt: SENT_AT,
      },
    ],
    expectedFinalNodeId: NODES.editorialPitches.id,
    allowNeedsHumanReview: true,
    misleadingKeywords: ["mourning", "funeral", "rituals", "ceremonies"],
  },
  {
    id: "tenoua-editorial-media-topic-distractors",
    difficulty: "medium",
    messages: [
      {
        subject: "Article pitch for Tenoua — media journalism and press interview ethics",
        senderEmail: "writer@example.com",
        senderName: "A Writer",
        bodyText:
          "Dear editors, I am submitting an article pitch for Tenoua on contemporary media journalism and press interview ethics. My editorial proposals examine how journalists conduct interviews and how media coverage shapes public discourse. I have a draft ready for your editorial review. Please advise if these editorial proposals fit your publication schedule.",
        receivedAt: SENT_AT,
      },
    ],
    expectedFinalNodeId: NODES.editorialPitches.id,
    allowNeedsHumanReview: true,
    misleadingKeywords: ["media", "journalist", "interview", "press"],
  },
  {
    id: "general-admin-inquiry",
    difficulty: "medium",
    messages: [
      {
        subject: "Administrative inquiry — document request and scheduling",
        senderEmail: "admin@example.com",
        senderName: "Community Admin",
        bodyText:
          "We need to request several documents and would like to schedule a brief meeting to coordinate. This is a general administrative matter with no ceremony or booking involved.",
        receivedAt: SENT_AT,
      },
    ],
    expectedFinalNodeId: NODES.generalSecretariat.id,
    allowNeedsHumanReview: true,
  },
  {
    id: "contributors-ongoing",
    difficulty: "easy",
    messages: [
      {
        subject: "My next column for Tenoua — submission for issue 47",
        senderEmail: "columnist@example.com",
        senderName: "A Regular Columnist",
        bodyText:
          "Dear team, as your regular contributor I am sending my next column for publication in issue 47. This is my ongoing column on Jewish thought and culture that I have been writing for Tenoua for the past three years. Please find the draft attached as usual. Looking forward to our continued collaboration.",
        receivedAt: SENT_AT,
      },
    ],
    expectedFinalNodeId: NODES.contributors.id,
    allowNeedsHumanReview: false,
  },
  {
    id: "partnerships-sponsorship",
    difficulty: "easy",
    messages: [
      {
        subject: "Sponsorship and co-branding partnership proposal for Tenoua",
        senderEmail: "partnerships@brand.com",
        senderName: "Brand Partnerships",
        bodyText:
          "Dear Tenoua team, we would like to propose a co-branding sponsorship partnership between our organisation and Tenoua. We believe a press partnership and sponsorship arrangement would benefit both parties. Please let us know if you are open to discussing partnership opportunities and co-branding terms.",
        receivedAt: SENT_AT,
      },
    ],
    expectedFinalNodeId: NODES.partnershipsPress.id,
    allowNeedsHumanReview: false,
  },
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
