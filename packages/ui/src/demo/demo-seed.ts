import { msg } from "@lingui/core/macro";
import type { I18n, MessageDescriptor } from "@lingui/core";
import { PROVIDER_LABEL_NAMESPACE, sanitizeProviderSegment } from "@amarnai/core/taxonomy";
import type { FolderItem } from "../folder-tree/types.js";
import type { ThreadItem, MemberItem, ThreadAssignment } from "../emails/types.js";
import { taxonomyTokens } from "../taxonomy/index.js";
import type { Node, Edge } from "@xyflow/react";
import { MarkerType } from "@xyflow/react";

// All user-visible demo copy is declared as Lingui messages and resolved at the
// render edge via the `getDemo*` builder functions below. The structural data
// (ids, positions, dates, counts, email addresses) stays static and
// locale-independent. The seed lives here rather than in one app because the
// landing page and the extension's first-run tab render the same demo; the
// Lingui extractor scans packages/ui/src, so the messages are still picked up.

// ─── Taxonomy definition ─────────────────────────────────────────────────────

type TaxonomyItem = {
  id: string;
  label: MessageDescriptor;
  description?: MessageDescriptor;
  parentId: string | null;
  isRoot?: boolean;
  position: { x: number; y: number };
  heroCount?: number;
};

const TAXONOMY: TaxonomyItem[] = [
  { id: "inbox",                label: msg`Inbox`,      isRoot: true,  parentId: null, position: { x: 40,  y: 310 } },
  { id: "customers",            label: msg`Customers`,  description: msg`Messages from paying customers and account holders.`,         parentId: null,        position: { x: 310, y: 100 } },
  { id: "customers-billing",     label: msg`Billing`,    description: msg`Invoice questions, overdue balances, and payment disputes.`,  parentId: "customers", position: { x: 600, y: 30  }, heroCount: 5 },
  { id: "customers-support",    label: msg`Support`,    description: msg`Help requests, supply issues, and escalations from customers.`, parentId: "customers", position: { x: 600, y: 170 }, heroCount: 7 },
  { id: "investors",            label: msg`Investors`,  description: msg`Updates, intros, and check-ins from current or prospective investors.`, parentId: null, position: { x: 310, y: 310 } },
  { id: "investors-current",    label: msg`Current`,    description: msg`Board members, existing fund partners, and portfolio updates.`, parentId: "investors", position: { x: 600, y: 310 }, heroCount: 3 },
  { id: "hiring",               label: msg`Hiring`,     description: msg`Applications, recruiter outreach, and interview scheduling.`, parentId: null,        position: { x: 310, y: 510 }, heroCount: 7 },
  { id: "other",                label: msg`Other`,      description: msg`Everything that doesn't fit a named folder.`,                 parentId: null,        position: { x: 310, y: 650 }, heroCount: 5 },
];

const TAXONOMY_BY_ID: Record<string, TaxonomyItem> = Object.fromEntries(
  TAXONOMY.map((item) => [item.id, item]),
);

// ─── ReactFlow canvas ─────────────────────────────────────────────────────────

export type DemoNodeData = {
  label: string;
  description?: string;
  isRoot: boolean;
  // Set by the reveal animation to fade/scale a card in as its level unfolds.
  entering?: boolean;
  enterDelay?: number;
};
export type DemoNode = Node<DemoNodeData, "demo-node">;

// Explicit node sizes (the root has no description, the rest wrap to two lines).
// The demo edge renderer derives its endpoints from these fixed sizes rather
// than React Flow's DOM-measured handle bounds, so edges attach identically in
// the initial and post-animation states instead of shifting with measurement
// timing. Giving the nodes the same dimensions keeps the cards sized to match.
const ROOT_SIZE = { width: 160, height: 68 };
const FOLDER_SIZE = { width: 220, height: 88 };

export type NodeSize = { width: number; height: number };

export const DEMO_NODE_SIZE: Record<string, NodeSize> = Object.fromEntries(
  TAXONOMY.map((item) => [item.id, item.isRoot ? ROOT_SIZE : FOLDER_SIZE]),
);

// Localized canvas nodes. Built per render so labels/descriptions resolve in the
// active locale; positions and sizes stay fixed.
export function getDemoNodes(i18n: I18n): DemoNode[] {
  return TAXONOMY.map((item) => ({
    id: item.id,
    type: "demo-node" as const,
    position: item.position,
    ...(item.isRoot ? ROOT_SIZE : FOLDER_SIZE),
    data: {
      label: i18n._(item.label),
      ...(item.description !== undefined && { description: i18n._(item.description) }),
      isRoot: item.isRoot ?? false,
    },
  }));
}

// Depth of each node in the tree: 0 = Inbox (root), 1 = its children,
// 2 = grandchildren. Drives the "Generate from inbox" reveal animation,
// which unfolds the tree one level at a time.
export const DEMO_NODE_DEPTH: Record<string, number> = Object.fromEntries(
  TAXONOMY.map((item) => [item.id, item.isRoot ? 0 : item.parentId === null ? 1 : 2]),
);

// The arrowhead the web taxonomy canvas uses: the ArrowClosed marker in the
// shared color, at React Flow's default size to match web's style. The demo edge
// renderer leaves a small gap before the node so this sits fully visible.
export const DEMO_ARROW = {
  type: MarkerType.ArrowClosed,
  color: taxonomyTokens.edgeDefault,
} as const;

function edge(id: string, source: string, target: string): Edge {
  return {
    id,
    source,
    target,
    type: "taxonomy-edge",
    markerEnd: { ...DEMO_ARROW },
    data: { targetIgnored: false },
  };
}

export const DEMO_EDGES: Edge[] = [
  ...TAXONOMY.filter((item) => !item.isRoot && item.parentId === null).map((item) =>
    edge(`e-inbox-${item.id}`, "inbox", item.id),
  ),
  ...TAXONOMY.filter((item) => item.parentId !== null).map((item) =>
    edge(`e-${item.parentId}-${item.id}`, item.parentId!, item.id),
  ),
];

// ─── Emails page ─────────────────────────────────────────────────────────────

export function getDemoFolders(i18n: I18n): FolderItem[] {
  return TAXONOMY.filter((item) => !item.isRoot).map((item) => ({
    id: item.id,
    name: i18n._(item.label),
    description: item.description ? i18n._(item.description) : "",
    parentId: item.parentId,
    ignored: false,
  }));
}

// ─── Workspace members ───────────────────────────────────────────────────────
//
// The demo's senders are the foreign rulers of the Amarna letters — people who
// write TO the court. Its team is the court itself: officials attested in
// Akhenaten's own administration, who work FOR it. Keeping the two casts apart
// is what makes an assignment read as "one of us picked this up" rather than as
// another correspondent appearing in a new place.
//
// Akhenaten is first because he is the owner: this is his inbox, the letters are
// addressed to him, and assigning a thread to yourself is a normal thing to do,
// so he has to be in the picker. Three members total, which is exactly what the
// Pharaoh plan allows (COLLABORATOR_LIMITS.BUSINESS = 2 seats beyond the owner)
// and what syncInfo claims this workspace is on — a fourth would put the demo in
// breach of its own plan badge.
//
// Names are short and distinctly initialled because most of the assignment UI is
// an avatar chip a few pixels wide, and they are wrapped for the same reason the
// senders' are: transliteration into non-Latin scripts, not translation.

/** The plan the demo workspace is on. Lives here rather than at each call site
 *  because it is one fact with the member list: the headcount below has to fit
 *  inside this plan's collaborator limit, and demo-seed.test.ts enforces it. */
export const DEMO_WORKSPACE_PLAN = "BUSINESS" as const;

const MEMBERS: { userId: string; name: MessageDescriptor; email: string }[] = [
  { userId: "u-akhenaten", name: msg`Akhenaten`, email: "akhenaten@akhetaten.eg" },
  { userId: "u-tutu", name: msg`Tutu`, email: "tutu@akhetaten.eg" },
  { userId: "u-pentu", name: msg`Pentu`, email: "pentu@akhetaten.eg" },
];

export function getDemoMembers(i18n: I18n): MemberItem[] {
  return MEMBERS.map((m) => ({ userId: m.userId, name: i18n._(m.name), email: m.email }));
}

/**
 * Who each thread is assigned to, by thread id.
 *
 * Half the list, with every member represented once: shared triage is a reason
 * to choose Amarnai over a personal-inbox tool, so the demo has to look like an
 * inbox several people are actually working, not like a solo inbox with an
 * assignment feature bolted on. One of them is the owner's own, so assigning
 * yourself reads as ordinary; the other three stay unassigned so the assign
 * affordance is on screen too.
 */
const ASSIGNMENTS: Record<string, string> = {
  t1: "u-akhenaten",
  t2: "u-pentu",
  t4: "u-tutu",
};

function assignmentFor(threadId: string, i18n: I18n): ThreadAssignment | null {
  const userId = ASSIGNMENTS[threadId];
  const member = MEMBERS.find((m) => m.userId === userId);
  if (!member) return null;
  return {
    userId: member.userId,
    userName: i18n._(member.name),
    userEmail: member.email,
    // Fixed rather than relative: the seed carries no clock.
    assignedAt: "2026-05-29T18:00:00.000Z",
  };
}

// ─── Provider labels ─────────────────────────────────────────────────────────

/**
 * The provider-side name each folder mirrors to, keyed by folder id, exactly as
 * the real writeback builds it: the "Amarnai" namespace followed by the folder's
 * ancestry. Gmail nests the segments on "/" and Outlook joins them into one flat
 * category display name, so both providers render the same string.
 *
 * The real taxonomy is a node+edge DAG and needs the canonical-parent walk in
 * @amarnai/core `buildProviderPaths` to pick one stable path per node. The demo
 * taxonomy is a plain parentId tree, where that walk reduces to following
 * parentId, so only the namespace constant and the segment sanitizer are shared.
 */
export function getDemoProviderLabels(i18n: I18n): Record<string, string[]> {
  const segmentsFor = (item: TaxonomyItem): string[] => {
    const parent = item.parentId ? TAXONOMY_BY_ID[item.parentId] : undefined;
    const ancestry = parent && !parent.isRoot ? segmentsFor(parent) : [];
    return [...ancestry, sanitizeProviderSegment(i18n._(item.label))];
  };

  return Object.fromEntries(
    TAXONOMY.filter((item) => !item.isRoot).map((item) => [
      item.id,
      [PROVIDER_LABEL_NAMESPACE, ...segmentsFor(item)],
    ]),
  );
}

// ─── Hero card ───────────────────────────────────────────────────────────────

type HeroLeaf = { id: string; label: string; count: number };
type HeroFolder = { id: string; label: string; children: HeroLeaf[] } | HeroLeaf;

export function getHeroTreeItems(i18n: I18n): HeroFolder[] {
  return TAXONOMY.filter((item) => !item.isRoot && item.parentId === null).map((item) => {
    const children = TAXONOMY.filter((c) => c.parentId === item.id);
    if (children.length > 0) {
      return {
        id: item.id,
        label: i18n._(item.label),
        children: children.map((c) => ({ id: c.id, label: i18n._(c.label), count: c.heroCount ?? 0 })),
      };
    }
    return { id: item.id, label: i18n._(item.label), count: item.heroCount ?? 0 };
  });
}

// ─── Draft bodies ─────────────────────────────────────────────────────────────

const DRAFT_BODIES: Record<string, MessageDescriptor> = {
  t1: msg`To the Great King, my brother,

I have heard your words. The gold shall be dispatched before the next messenger departs. We value the bond between our houses and do not wish for it to cool.

In friendship,`,
  t2: msg`Aziru,

Your words of friendship reach us well. We are open to hearing more of what the house of Amurru proposes. Send your terms by the next courier.

With regards,`,
  t3: msg`To the Bureau of Royal Appointments,

We have received the application from Horemheb of Thebes and will review his record before the next new moon. Please inform him that we will send word in due course.

By royal decree,`,
  t4: msg`Rib-Hadda,

We hear you. Additional grain has been ordered from the southern stores and will arrive before the harvest festival. We ask for your patience until then.

Be well,`,
  t5: msg`Abdi-Heba,

I will be near the Delta that same week. Let us meet at the waystation on the second day; I can spare the morning.

Until then,`,
  t6: msg`Great King,

The reports you requested will be prepared before the council convenes. I will have my scribes compile the accounts of the eastern territories and send them ahead by fast courier.

In brotherhood,`,
};

export function getDemoDraftBodies(i18n: I18n): Record<string, string> {
  return Object.fromEntries(
    Object.entries(DRAFT_BODIES).map(([id, body]) => [id, i18n._(body)]),
  );
}

// ─── Thread summaries ─────────────────────────────────────────────────────────
//
// Canned TL;DRs standing in for the lazily-generated ones. Only the
// multi-message threads have one: in the real app a single-message thread shows
// its stored snippet instead and never calls a model, so seeding a summary for
// t3/t5 would misrepresent the product.

const THREAD_SUMMARIES: Record<string, MessageDescriptor> = {
  t1: msg`Babylon's third gold consignment is overdue after two messengers. Burna-Buriash asks you to dispatch it without further delay.`,
  t2: msg`Aziru proposes a formal pact of mutual protection and shared routes, and wants word sent back by the next courier.`,
  t4: msg`Byblos is still waiting on the third grain shipment and the city is restless. Rib-Hadda has now written seven times.`,
  t6: msg`The council convenes at the start of Shemu. Tushratta asks for a full accounting of the eastern territories, sent ahead by fast courier.`,
};

// Bulleted TL;DRs for threads that enumerate concrete facts — the case the
// bullets format exists for. Prose stays the default everywhere else.
const THREAD_SUMMARY_BULLETS: Record<string, MessageDescriptor[]> = {
  t6: [
    msg`Council convenes at the start of Shemu`,
    msg`Full accounting of the eastern territories requested`,
    msg`Send ahead by fast courier, before the new moon`,
  ],
};

export function getDemoSummaries(i18n: I18n): Record<string, string> {
  return Object.fromEntries(
    Object.entries(THREAD_SUMMARIES)
      .filter(([id]) => !(id in THREAD_SUMMARY_BULLETS))
      .map(([id, text]) => [id, i18n._(text)]),
  );
}

export function getDemoSummaryBullets(i18n: I18n): Record<string, string[]> {
  return Object.fromEntries(
    Object.entries(THREAD_SUMMARY_BULLETS).map(([id, items]) => [
      id,
      items.map((m) => i18n._(m)),
    ]),
  );
}

// ─── Thread data ──────────────────────────────────────────────────────────────

const d = (iso: string) => new Date(iso);

type ThreadMessageSeed = {
  id: string;
  fromName: MessageDescriptor;
  fromEmail: string;
  time: Date;
  snippet: MessageDescriptor;
  bodyText: MessageDescriptor;
};

type ThreadSeed = Omit<
  ThreadItem,
  "subject" | "snippet" | "reasoning" | "alternativeFolder" | "messages" | "provider" | "webLink"
> & {
  subject: MessageDescriptor;
  snippet: MessageDescriptor;
  reasoning: MessageDescriptor;
  // alternativeFolder carries only the target folder id and weight; its display
  // name is resolved from the taxonomy label so it always matches the folder.
  alternativeFolder: { folderId: string; weight: number } | null;
  messages: ThreadMessageSeed[];
};

const THREAD_SEED: ThreadSeed[] = [
  {
    id: "t1",
    subject: msg`Gold balance: third consignment overdue`,
    providerThreadId: "p1",
    participants: "burna.buriash@babylon.iq",
    latestAt: d("2026-05-30T10:14:00Z"),
    messageCount: 3,
    snippet: msg`The third gold consignment agreed under our treaty has not arrived. Two messengers have passed and still we wait.`,
    unread: true,
    folderId: "customers-billing",
    status: "sorted",
    confidence: 0.96,
    reasoning: msg`Sender is a known treaty partner of significant standing. Subject explicitly references an outstanding balance on an agreed consignment, which matches the Billing folder.`,
    alternativeFolder: null,
    messages: [
      {
        id: "m1a",
        fromName: msg`Burna-Buriash II`,
        fromEmail: "burna.buriash@babylon.iq",
        time: d("2026-05-30T10:14:00Z"),
        snippet: msg`The third gold consignment is overdue.`,
        bodyText: msg`To the Great King, my brother,

I write in friendship, as our fathers wrote before us. The third gold consignment agreed under our treaty has not arrived. Two messengers have passed and still we wait.

We ask that you dispatch it without further delay, as befits the bond between our houses.

Burna-Buriash II, King of Babylon`,
      },
    ],
    hasDraft: false,
    isDrafting: false,
    lastSenderEmail: "burna.buriash@babylon.iq",
    doneMark: null,
    assignment: null,
    isImportant: false,
    isClassifying: false,
    attachmentCount: 0,
    commentCount: 0,
    unreadCommentCount: 0,
  },
  {
    id: "t2",
    subject: msg`Alliance proposal: house of Amurru`,
    providerThreadId: "p2",
    participants: "aziru@amurru.co",
    latestAt: d("2026-05-29T16:45:00Z"),
    messageCount: 2,
    snippet: msg`For many years our houses have been as brothers. I write now to propose that we formalise this friendship for the benefit of both our peoples.`,
    unread: true,
    folderId: "investors",
    status: "review",
    confidence: 0.71,
    reasoning: msg`Flagged as alliance/investor intro based on language ("mutual benefit", "long-standing friendship"). Confidence is moderate; Aziru has been known to send similar overtures to multiple courts.`,
    alternativeFolder: { folderId: "other", weight: 0.21 },
    messages: [
      {
        id: "m2a",
        fromName: msg`Aziru of Amurru`,
        fromEmail: "aziru@amurru.co",
        time: d("2026-05-29T16:45:00Z"),
        snippet: msg`I write to propose that we formalise our friendship.`,
        bodyText: msg`To the Great King,

For many years our houses have been as brothers. I write now to propose that we formalise this friendship for the benefit of both our peoples: a pact of mutual protection and shared routes.

I ask only that you hear my terms. Send word by the next courier and I will dispatch my envoy at once.

Aziru, servant of the Great King, lord of Amurru`,
      },
    ],
    hasDraft: true,
    isDrafting: false,
    lastSenderEmail: "aziru@amurru.co",
    doneMark: null,
    assignment: null,
    isImportant: false,
    isClassifying: false,
    attachmentCount: 0,
    commentCount: 0,
    unreadCommentCount: 0,
  },
  {
    id: "t3",
    subject: msg`Application: Chief of Correspondence`,
    providerThreadId: "p3",
    participants: "appointments@house-of-records.clay",
    latestAt: d("2026-05-29T09:22:00Z"),
    messageCount: 1,
    snippet: msg`A new application has been received from Horemheb of Thebes for the position of Chief of Correspondence.`,
    unread: false,
    folderId: "hiring",
    status: "sorted",
    confidence: 0.98,
    reasoning: msg`Automated notice from the Bureau of Royal Appointments. Subject and sender clearly indicate a new application for an open position.`,
    alternativeFolder: null,
    messages: [
      {
        id: "m3a",
        fromName: msg`Bureau of Royal Appointments`,
        fromEmail: "appointments@house-of-records.clay",
        time: d("2026-05-29T09:22:00Z"),
        snippet: msg`New application from Horemheb of Thebes.`,
        bodyText: msg`A new application has been received from Horemheb of Thebes for the position of Chief of Correspondence.

View the application in the House of Records.`,
      },
    ],
    hasDraft: false,
    isDrafting: false,
    lastSenderEmail: "appointments@house-of-records.clay",
    doneMark: null,
    assignment: null,
    isImportant: false,
    isClassifying: false,
    attachmentCount: 0,
    commentCount: 0,
    unreadCommentCount: 0,
  },
  {
    id: "t4",
    subject: msg`Re: Grain shipment: third delay this season`,
    providerThreadId: "p4",
    participants: "rib-hadda@byblos.lb",
    latestAt: d("2026-05-28T14:10:00Z"),
    messageCount: 4,
    snippet: msg`The grain you sent last month was received with gratitude. But I must write again: the third shipment has not arrived and the city grows restless.`,
    unread: false,
    folderId: "customers-support",
    status: "sorted",
    confidence: 0.93,
    reasoning: msg`Ongoing thread with a known city governor raising a recurring supply issue. Escalatory tone and repeated follow-ups match the Support folder.`,
    alternativeFolder: null,
    messages: [
      {
        id: "m4a",
        fromName: msg`Rib-Hadda of Byblos`,
        fromEmail: "rib-hadda@byblos.lb",
        time: d("2026-05-28T14:10:00Z"),
        snippet: msg`The third grain shipment has not arrived.`,
        bodyText: msg`To the Great King, my lord, my sun,

The grain you sent last month was received with gratitude and I praised your name before the people. But I must write again: the third shipment has not arrived and the city grows restless.

I have written seven times. I do not wish to trouble you, yet what else can I do?

Your servant, Rib-Hadda, governor of Byblos`,
      },
    ],
    hasDraft: true,
    isDrafting: false,
    lastSenderEmail: "rib-hadda@byblos.lb",
    doneMark: null,
    assignment: null,
    isImportant: false,
    isClassifying: false,
    attachmentCount: 0,
    commentCount: 0,
    unreadCommentCount: 0,
  },
  {
    id: "t5",
    subject: msg`Passing through the Delta: free to meet?`,
    providerThreadId: "p5",
    participants: "abdi-heba@urusalim.gov",
    latestAt: d("2026-05-27T18:33:00Z"),
    messageCount: 1,
    snippet: msg`My travels bring me near the Delta in the coming days. If the Great King has an hour to spare, I would welcome the chance to speak face to face.`,
    unread: false,
    folderId: "other",
    status: "review",
    confidence: 0.52,
    reasoning: msg`Informal message with no clear category: personal visit or political audience? Tone is personal but sender is a known vassal governor. Routed to Other with low confidence.`,
    alternativeFolder: { folderId: "customers-support", weight: 0.28 },
    messages: [
      {
        id: "m5a",
        fromName: msg`Abdi-Heba of Urushalim`,
        fromEmail: "abdi-heba@urusalim.gov",
        time: d("2026-05-27T18:33:00Z"),
        snippet: msg`Passing through the Delta: free to meet?`,
        bodyText: msg`To the Great King,

My travels bring me near the Delta in the coming days. If the Great King has an hour to spare, I would welcome the chance to speak face to face; there are matters easier said than written.

Your servant, Abdi-Heba, governor of Urushalim`,
      },
    ],
    hasDraft: false,
    isDrafting: false,
    lastSenderEmail: "abdi-heba@urusalim.gov",
    doneMark: null,
    assignment: null,
    isImportant: false,
    isClassifying: false,
    attachmentCount: 0,
    commentCount: 0,
    unreadCommentCount: 0,
  },
  {
    id: "t6",
    subject: msg`Council convening: season of Shemu`,
    providerThreadId: "p6",
    participants: "tushratta@mitanni.int",
    latestAt: d("2026-05-26T11:00:00Z"),
    messageCount: 2,
    snippet: msg`The great council convenes at the start of Shemu. I ask that you prepare a full accounting of the eastern territories and send it ahead by fast courier.`,
    unread: false,
    folderId: "investors-current",
    status: "sorted",
    confidence: 0.91,
    reasoning: msg`Council preparation request from a known royal ally. Sender domain and context clearly match the Current investors folder.`,
    alternativeFolder: null,
    messages: [
      {
        id: "m6a",
        fromName: msg`Tushratta of Mitanni`,
        fromEmail: "tushratta@mitanni.int",
        time: d("2026-05-26T11:00:00Z"),
        snippet: msg`Prepare your accounts before the council convenes.`,
        bodyText: msg`To my brother, the Great King,

The great council convenes at the start of Shemu. I ask that you prepare a full accounting of the eastern territories and send it ahead by fast courier, before the new moon if possible.

Our alliance is strong. Let us show the council that it remains so.

Tushratta, Great King of Mitanni`,
      },
    ],
    hasDraft: false,
    isDrafting: false,
    lastSenderEmail: "tushratta@mitanni.int",
    doneMark: null,
    assignment: null,
    isImportant: false,
    isClassifying: false,
    attachmentCount: 0,
    commentCount: 0,
    unreadCommentCount: 0,
  },
];

export function getDemoThreads(
  i18n: I18n,
  provider: "GMAIL" | "OUTLOOK" = "GMAIL",
): ThreadItem[] {
  return THREAD_SEED.map((seed) => {
    const { subject, snippet, reasoning, alternativeFolder, messages, ...rest } = seed;
    return {
      ...rest,
      // The demo frame previews both providers; the caller passes whichever
      // inbox is currently shown so the workspace's "Open in <provider>" link
      // matches the mock beside it.
      provider,
      webLink: null,
      // Resolved here rather than baked into the seed: an assignee's display
      // name goes through the same locale as every other name in the demo.
      assignment: assignmentFor(seed.id, i18n),
      subject: i18n._(subject),
      snippet: i18n._(snippet),
      reasoning: i18n._(reasoning),
      alternativeFolder: alternativeFolder
        ? {
            folderId: alternativeFolder.folderId,
            name: i18n._(TAXONOMY_BY_ID[alternativeFolder.folderId]!.label),
            weight: alternativeFolder.weight,
          }
        : null,
      messages: messages.map((m) => ({
        ...m,
        fromName: i18n._(m.fromName),
        snippet: i18n._(m.snippet),
        bodyText: i18n._(m.bodyText),
      })),
    };
  });
}
