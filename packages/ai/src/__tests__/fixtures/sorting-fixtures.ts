import type { TaxonomyNodeInput, TaxonomyEdgeInput, ThreadMessage } from "../../types.js";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function node(
  id: string,
  name: string,
  description: string | null,
  opts: { isRoot?: boolean; visible?: boolean; receiving?: boolean } = {}
): TaxonomyNodeInput {
  return {
    id,
    name,
    description,
    instructions: null,
    examples: [],
    isRoot: opts.isRoot ?? false,
    isVisibleCategory: opts.visible ?? true,
    canReceiveEmails: opts.receiving ?? true,
  };
}

function edge(
  id: string,
  sourceNodeId: string,
  targetNodeId: string,
  sortingQuestion: string
): TaxonomyEdgeInput {
  return { id, sourceNodeId, targetNodeId, sortingQuestion, examples: [], negativeExamples: [] };
}

const HIDDEN = { visible: false, receiving: false } as const;

// ─── Taxonomy ─────────────────────────────────────────────────────────────────
//
// Inbox [root, hidden]
// ├── Secretariat triage [hidden]
// │   ├── Lifecycle ceremony triage [hidden]
// │   │   ├── Weddings
// │   │   └── Funerals
// │   ├── Booking qualification [hidden]
// │   │   ├── Conferences / invitations
// │   │   └── Media / interviews
// │   └── General secretariat
// ├── Tenoua routing [hidden]
// │   ├── Editorial / pitches
// │   ├── Contributors
// │   ├── Subscriptions / distribution
// │   └── Partnerships / press
// └── Other / needs review

export const NODES = {
  inbox: node("inbox", "Inbox", null, { isRoot: true, ...HIDDEN }),

  secretariatTriage: node(
    "secretariat-triage",
    "Secretariat triage",
    "Hidden routing step for secretariat requests: ceremonies, bookings, and general inquiries.",
    HIDDEN
  ),

  lifecycleTriage: node(
    "lifecycle-triage",
    "Lifecycle ceremony triage",
    "Hidden routing step for wedding and funeral ceremony requests.",
    HIDDEN
  ),

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

  bookingQualification: node(
    "booking-qualification",
    "Booking qualification",
    "Hidden routing step for event bookings, speaking invitations, and media appearances.",
    HIDDEN
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

  tenouaRouting: node(
    "tenoua-routing",
    "Tenoua routing",
    "Hidden routing step for Tenoua magazine emails.",
    HIDDEN
  ),

  editorialPitches: node(
    "editorial-pitches",
    "Editorial / pitches",
    "New article pitches and editorial proposals from writers who want to be published in Tenoua for the first time or submit a specific piece."
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
  inboxToSecretariat: edge(
    "e-inbox-sec",
    "inbox",
    "secretariat-triage",
    "Is this a secretariat request? (ceremonies, bookings, general administrative inquiries)"
  ),
  secretariatToLifecycle: edge(
    "e-sec-lifecycle",
    "secretariat-triage",
    "lifecycle-triage",
    "Is this about a lifecycle ceremony — a wedding or a funeral?"
  ),
  lifecycleToWeddings: edge(
    "e-lifecycle-weddings",
    "lifecycle-triage",
    "weddings",
    "Is this specifically about a wedding ceremony?"
  ),
  lifecycleToFunerals: edge(
    "e-lifecycle-funerals",
    "lifecycle-triage",
    "funerals",
    "Is this specifically about a funeral or bereavement service?"
  ),
  secretariatToBooking: edge(
    "e-sec-booking",
    "secretariat-triage",
    "booking-qualification",
    "Is this a booking for an event, conference, or media appearance?"
  ),
  bookingToConferences: edge(
    "e-booking-conf",
    "booking-qualification",
    "conferences-invitations",
    "Is this a conference, seminar, or public speaking invitation?"
  ),
  bookingToMedia: edge(
    "e-booking-media",
    "booking-qualification",
    "media-interviews",
    "Is this a press interview, media appearance, or journalist inquiry?"
  ),
  secretariatToGeneral: edge(
    "e-sec-general",
    "secretariat-triage",
    "general-secretariat",
    "Is this a general administrative request that does not fit ceremonies or bookings?"
  ),
  inboxToTenoua: edge(
    "e-inbox-tenoua",
    "inbox",
    "tenoua-routing",
    "Is this related to the Tenoua magazine (editorial, subscriptions, contributors, partnerships)?"
  ),
  tenouaToEditorial: edge(
    "e-tenoua-editorial",
    "tenoua-routing",
    "editorial-pitches",
    "Is this a new article pitch or editorial proposal from a writer who wants to be published in Tenoua?"
  ),
  tenouaToContributors: edge(
    "e-tenoua-contributors",
    "tenoua-routing",
    "contributors",
    "Is this from an established Tenoua contributor or staff member who already writes regularly for the magazine?"
  ),
  tenouaToSubscriptions: edge(
    "e-tenoua-subs",
    "tenoua-routing",
    "subscriptions-distribution",
    "Is this a subscription request from a reader — signing up, renewing, or asking about distribution?"
  ),
  tenouaToPartnerships: edge(
    "e-tenoua-partnerships",
    "tenoua-routing",
    "partnerships-press",
    "Is this a partnership, sponsorship, or press inquiry for Tenoua?"
  ),
  inboxToOther: edge(
    "e-inbox-other",
    "inbox",
    "other-needs-review",
    "Does this email not fit any known category?"
  ),
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
    // Journalist/media request with strong media-interviews signals (journalist,
    // interview, media appearance) and no conference, wedding, or Tenoua tokens.
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
    // Subscription renewal email. Misleading tokens (mourning, funeral, ceremonies)
    // score for the Funerals path, but subscription/distribution tokens should
    // keep Subscriptions / distribution ranked above Funerals in candidates.
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
    // Editorial pitch whose TOPIC is mourning rituals. Misleading tokens (mourning,
    // funeral, rituals, ceremonies) score for the Funerals path. The dominant
    // editorial/article/pitch/draft signals should keep Editorial / pitches ranked
    // above Funerals in candidate-path scoring; the LLM must recognise this as a
    // magazine submission, not a personal funeral service request.
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
    // Editorial pitch to Tenoua whose TOPIC is media/journalism. Misleading tokens
    // (media, journalist, interview, press) score for the Media / interviews path.
    // The dominant editorial/article/proposals/tenoua signals should keep
    // Editorial / pitches ranked above Media / interviews in candidate-path scoring;
    // the LLM must recognise this as a magazine submission, not a broadcast request.
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
];
