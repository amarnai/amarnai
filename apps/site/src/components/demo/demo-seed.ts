import type { FolderItem } from "@amarnai/ui/folder-tree";
import type { ThreadItem } from "@amarnai/ui/emails";
import type { Node, Edge } from "@xyflow/react";
import { MarkerType } from "@xyflow/react";

// ─── Taxonomy definition ─────────────────────────────────────────────────────

type TaxonomyItem = {
  id: string;
  label: string;
  description?: string;
  parentId: string | null;
  isRoot?: boolean;
  position: { x: number; y: number };
  heroCount?: number;
};

const TAXONOMY: TaxonomyItem[] = [
  { id: "inbox",                label: "Inbox",      isRoot: true,  parentId: null, position: { x: 40,  y: 310 } },
  { id: "customers",            label: "Customers",  description: "Messages from paying customers and account holders.",         parentId: null,        position: { x: 310, y: 100 } },
  { id: "customers-enterprise", label: "Enterprise", description: "Named accounts, contract renewals, and CSM threads.",         parentId: "customers", position: { x: 600, y: 30  }, heroCount: 5 },
  { id: "customers-smb",        label: "SMB",        description: "Self-serve customers, billing questions, and support.",       parentId: "customers", position: { x: 600, y: 170 }, heroCount: 7 },
  { id: "investors",            label: "Investors",  description: "Updates, intros, and check-ins from current or prospective investors.", parentId: null, position: { x: 310, y: 310 } },
  { id: "investors-current",    label: "Current",    description: "Board members, existing fund partners, and portfolio updates.", parentId: "investors", position: { x: 600, y: 310 }, heroCount: 3 },
  { id: "hiring",               label: "Hiring",     description: "Applications, recruiter outreach, and interview scheduling.", parentId: null,        position: { x: 310, y: 510 }, heroCount: 7 },
  { id: "other",                label: "Other",      description: "Everything that doesn't fit a named folder.",                 parentId: null,        position: { x: 310, y: 650 }, heroCount: 5 },
];

// ─── ReactFlow canvas ─────────────────────────────────────────────────────────

export type DemoNodeData = { label: string; description?: string; isRoot: boolean };
export type DemoNode = Node<DemoNodeData, "demo-node">;

export const DEMO_NODES: DemoNode[] = TAXONOMY.map((item) => ({
  id: item.id,
  type: "demo-node" as const,
  position: item.position,
  data: {
    label: item.label,
    ...(item.description !== undefined && { description: item.description }),
    isRoot: item.isRoot ?? false,
  },
}));

const EDGE_COLOR = "#94a3b8";

function edge(id: string, source: string, target: string): Edge {
  return {
    id,
    source,
    target,
    markerEnd: { type: MarkerType.ArrowClosed, color: EDGE_COLOR },
    style: { stroke: EDGE_COLOR, strokeWidth: 1.5 },
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

export const DEMO_FOLDERS: FolderItem[] = TAXONOMY.filter((item) => !item.isRoot).map((item) => ({
  id: item.id,
  name: item.label,
  description: item.description ?? "",
  parentId: item.parentId,
  ignored: false,
}));

// ─── Hero card ───────────────────────────────────────────────────────────────

type HeroLeaf = { id: string; label: string; count: number };
type HeroFolder = { id: string; label: string; children: HeroLeaf[] } | HeroLeaf;

export const HERO_TREE_ITEMS: HeroFolder[] = TAXONOMY.filter(
  (item) => !item.isRoot && item.parentId === null,
).map((item) => {
  const children = TAXONOMY.filter((c) => c.parentId === item.id);
  if (children.length > 0) {
    return {
      id: item.id,
      label: item.label,
      children: children.map((c) => ({ id: c.id, label: c.label, count: c.heroCount ?? 0 })),
    };
  }
  return { id: item.id, label: item.label, count: item.heroCount ?? 0 };
});

// ─── Draft bodies ─────────────────────────────────────────────────────────────

export const DEMO_DRAFT_BODIES: Record<string, string> = {
  t1: "To the Great King, my brother,\n\nI have heard your words. The gold shall be dispatched before the next messenger departs. We value the bond between our houses and do not wish for it to cool.\n\nIn friendship,",
  t2: "Aziru,\n\nYour words of friendship reach us well. We are open to hearing more of what the house of Amurru proposes. Send your terms by the next courier.\n\nWith regards,",
  t3: "To the Bureau of Royal Appointments,\n\nWe have received the application from Horemheb of Thebes and will review his record before the next new moon. Please inform him that we will send word in due course.\n\nBy royal decree,",
  t4: "Rib-Hadda,\n\nWe hear you. Additional grain has been ordered from the southern stores and will arrive before the harvest festival. We ask for your patience until then.\n\nBe well,",
  t5: "Abdi-Heba,\n\nI will be near the Delta that same week. Let us meet at the waystation on the second day; I can spare the morning.\n\nUntil then,",
  t6: "Great King,\n\nThe reports you requested will be prepared before the council convenes. I will have my scribes compile the accounts of the eastern territories and send them ahead by fast courier.\n\nIn brotherhood,",
};

// ─── Thread data ──────────────────────────────────────────────────────────────

const d = (iso: string) => new Date(iso);

export const DEMO_THREADS: ThreadItem[] = [
  {
    id: "t1",
    subject: "Gold balance: third consignment overdue",
    providerThreadId: "p1",
    participants: "burna.buriash@babylon.iq",
    latestAt: d("2026-05-30T10:14:00Z"),
    messageCount: 3,
    snippet: "The third gold consignment agreed under our treaty has not arrived. Two messengers have passed and still we wait.",
    unread: true,
    folderId: "customers-enterprise",
    status: "sorted",
    confidence: 0.96,
    reasoning: "Sender is a known treaty partner of significant standing. Subject explicitly references an outstanding balance, which matches the Enterprise folder description.",
    alternativeFolder: null,
    messages: [
      {
        id: "m1a",
        fromName: "Burna-Buriash II",
        fromEmail: "burna.buriash@babylon.iq",
        time: d("2026-05-30T10:14:00Z"),
        snippet: "The third gold consignment is overdue.",
        bodyText: "To the Great King, my brother,\n\nI write in friendship, as our fathers wrote before us. The third gold consignment agreed under our treaty has not arrived. Two messengers have passed and still we wait.\n\nWe ask that you dispatch it without further delay, as befits the bond between our houses.\n\nBurna-Buriash II, King of Babylon",
      },
    ],
    hasDraft: false,
    isDrafting: false,
    lastSenderEmail: "burna.buriash@babylon.iq",
    doneMark: null,
  },
  {
    id: "t2",
    subject: "Alliance proposal: house of Amurru",
    providerThreadId: "p2",
    participants: "aziru@amurru.co",
    latestAt: d("2026-05-29T16:45:00Z"),
    messageCount: 2,
    snippet: "For many years our houses have been as brothers. I write now to propose that we formalise this friendship for the benefit of both our peoples.",
    unread: true,
    folderId: "investors",
    status: "review",
    confidence: 0.71,
    reasoning: "Flagged as alliance/investor intro based on language (\"mutual benefit\", \"long-standing friendship\"). Confidence is moderate; Aziru has been known to send similar overtures to multiple courts.",
    alternativeFolder: { folderId: "other", name: "Other", weight: 0.21 },
    messages: [
      {
        id: "m2a",
        fromName: "Aziru of Amurru",
        fromEmail: "aziru@amurru.co",
        time: d("2026-05-29T16:45:00Z"),
        snippet: "I write to propose that we formalise our friendship.",
        bodyText: "To the Great King,\n\nFor many years our houses have been as brothers. I write now to propose that we formalise this friendship for the benefit of both our peoples: a pact of mutual protection and shared routes.\n\nI ask only that you hear my terms. Send word by the next courier and I will dispatch my envoy at once.\n\nAziru, servant of the Great King, lord of Amurru",
      },
    ],
    hasDraft: true,
    isDrafting: false,
    lastSenderEmail: "aziru@amurru.co",
    doneMark: null,
  },
  {
    id: "t3",
    subject: "Application: Chief of Correspondence",
    providerThreadId: "p3",
    participants: "appointments@house-of-records.clay",
    latestAt: d("2026-05-29T09:22:00Z"),
    messageCount: 1,
    snippet: "A new application has been received from Horemheb of Thebes for the position of Chief of Correspondence.",
    unread: false,
    folderId: "hiring",
    status: "sorted",
    confidence: 0.98,
    reasoning: "Automated notice from the Bureau of Royal Appointments. Subject and sender clearly indicate a new application for an open position.",
    alternativeFolder: null,
    messages: [
      {
        id: "m3a",
        fromName: "Bureau of Royal Appointments",
        fromEmail: "appointments@house-of-records.clay",
        time: d("2026-05-29T09:22:00Z"),
        snippet: "New application from Horemheb of Thebes.",
        bodyText: "A new application has been received from Horemheb of Thebes for the position of Chief of Correspondence.\n\nView the application in the House of Records.",
      },
    ],
    hasDraft: false,
    isDrafting: false,
    lastSenderEmail: "appointments@house-of-records.clay",
    doneMark: null,
  },
  {
    id: "t4",
    subject: "Re: Grain shipment: third delay this season",
    providerThreadId: "p4",
    participants: "rib-hadda@byblos.lb",
    latestAt: d("2026-05-28T14:10:00Z"),
    messageCount: 4,
    snippet: "The grain you sent last month was received with gratitude. But I must write again: the third shipment has not arrived and the city grows restless.",
    unread: false,
    folderId: "customers-smb",
    status: "sorted",
    confidence: 0.93,
    reasoning: "Ongoing thread with a known city governor raising a recurring supply issue. Sender domain and persistent tone match the SMB folder.",
    alternativeFolder: null,
    messages: [
      {
        id: "m4a",
        fromName: "Rib-Hadda of Byblos",
        fromEmail: "rib-hadda@byblos.lb",
        time: d("2026-05-28T14:10:00Z"),
        snippet: "The third grain shipment has not arrived.",
        bodyText: "To the Great King, my lord, my sun,\n\nThe grain you sent last month was received with gratitude and I praised your name before the people. But I must write again: the third shipment has not arrived and the city grows restless.\n\nI have written seven times. I do not wish to trouble you, yet what else can I do?\n\nYour servant, Rib-Hadda, governor of Byblos",
      },
    ],
    hasDraft: true,
    isDrafting: false,
    lastSenderEmail: "rib-hadda@byblos.lb",
    doneMark: null,
  },
  {
    id: "t5",
    subject: "Passing through the Delta: free to meet?",
    providerThreadId: "p5",
    participants: "abdi-heba@urusalim.gov",
    latestAt: d("2026-05-27T18:33:00Z"),
    messageCount: 1,
    snippet: "My travels bring me near the Delta in the coming days. If the Great King has an hour to spare, I would welcome the chance to speak face to face.",
    unread: false,
    folderId: "other",
    status: "review",
    confidence: 0.52,
    reasoning: "Informal message with no clear category: personal visit or political audience? Tone is personal but sender is a known vassal governor. Routed to Other with low confidence.",
    alternativeFolder: { folderId: "customers-smb", name: "SMB", weight: 0.28 },
    messages: [
      {
        id: "m5a",
        fromName: "Abdi-Heba of Urushalim",
        fromEmail: "abdi-heba@urusalim.gov",
        time: d("2026-05-27T18:33:00Z"),
        snippet: "Passing through the Delta: free to meet?",
        bodyText: "To the Great King,\n\nMy travels bring me near the Delta in the coming days. If the Great King has an hour to spare, I would welcome the chance to speak face to face; there are matters easier said than written.\n\nYour servant, Abdi-Heba, governor of Urushalim",
      },
    ],
    hasDraft: false,
    isDrafting: false,
    lastSenderEmail: "abdi-heba@urusalim.gov",
    doneMark: null,
  },
  {
    id: "t6",
    subject: "Council convening: season of Shemu",
    providerThreadId: "p6",
    participants: "tushratta@mitanni.int",
    latestAt: d("2026-05-26T11:00:00Z"),
    messageCount: 2,
    snippet: "The great council convenes at the start of Shemu. I ask that you prepare a full accounting of the eastern territories and send it ahead by fast courier.",
    unread: false,
    folderId: "investors-current",
    status: "sorted",
    confidence: 0.91,
    reasoning: "Council preparation request from a known royal ally. Sender domain and context clearly match the Current investors folder.",
    alternativeFolder: null,
    messages: [
      {
        id: "m6a",
        fromName: "Tushratta of Mitanni",
        fromEmail: "tushratta@mitanni.int",
        time: d("2026-05-26T11:00:00Z"),
        snippet: "Prepare your accounts before the council convenes.",
        bodyText: "To my brother, the Great King,\n\nThe great council convenes at the start of Shemu. I ask that you prepare a full accounting of the eastern territories and send it ahead by fast courier, before the new moon if possible.\n\nOur alliance is strong. Let us show the council that it remains so.\n\nTushratta, Great King of Mitanni",
      },
    ],
    hasDraft: false,
    isDrafting: false,
    lastSenderEmail: "tushratta@mitanni.int",
    doneMark: null,
  },
];
