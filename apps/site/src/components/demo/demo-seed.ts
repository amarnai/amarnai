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
  data: { label: item.label, description: item.description, isRoot: item.isRoot ?? false },
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

// ─── Thread data ──────────────────────────────────────────────────────────────

const d = (iso: string) => new Date(iso);

export const DEMO_THREADS: ThreadItem[] = [
  {
    id: "t1",
    subject: "Q3 invoice — payment due Friday",
    providerThreadId: "p1",
    participants: "billing@acmecorp.com",
    latestAt: d("2026-05-30T10:14:00Z"),
    messageCount: 3,
    snippet: "Hi, just a reminder that invoice #1042 is due this Friday. Please let us know if you have any questions.",
    unread: true,
    folderId: "customers-enterprise",
    status: "sorted",
    confidence: 0.96,
    reasoning: "Sender is a known enterprise customer domain. Subject explicitly references an invoice number, which matches the Enterprise folder description.",
    alternativeFolder: null,
    messages: [
      {
        id: "m1a",
        fromName: "Acme Corp Billing",
        fromEmail: "billing@acmecorp.com",
        time: d("2026-05-30T10:14:00Z"),
        snippet: "Invoice #1042 is due this Friday.",
        bodyText: "Hi,\n\nJust a reminder that invoice #1042 ($4,200) is due this Friday, May 31st.\n\nPlease let us know if you have any questions.\n\nBest,\nAcme Corp Billing",
      },
    ],
    hasDraft: false,
    isDrafting: false,
    lastSenderEmail: "billing@acmecorp.com",
    doneMark: null,
  },
  {
    id: "t2",
    subject: "Intro: Sarah Chen / Sequoia",
    providerThreadId: "p2",
    participants: "sarah.chen@sequoia.com",
    latestAt: d("2026-05-29T16:45:00Z"),
    messageCount: 2,
    snippet: "Sarah is a partner at Sequoia who has been following Amarnai. She'd love a quick call.",
    unread: true,
    folderId: "investors",
    status: "review",
    confidence: 0.71,
    reasoning: "Flagged as investor intro based on sender domain and language (\"partner\", \"following your company\"). Confidence is moderate — could also be a sales outreach.",
    alternativeFolder: { folderId: "other", name: "Other", weight: 0.21 },
    messages: [
      {
        id: "m2a",
        fromName: "Marcus Webb",
        fromEmail: "marcus@webpartners.vc",
        time: d("2026-05-29T16:45:00Z"),
        snippet: "Wanted to make an intro to Sarah Chen at Sequoia.",
        bodyText: "Hey,\n\nWanted to make a quick intro — Sarah Chen is a partner at Sequoia who has been following Amarnai for a few months. She'd love a 20-minute call.\n\nCC'ing her here.\n\nMarcus",
      },
    ],
    hasDraft: true,
    isDrafting: false,
    lastSenderEmail: "marcus@webpartners.vc",
    doneMark: null,
  },
  {
    id: "t3",
    subject: "Application: Senior Software Engineer",
    providerThreadId: "p3",
    participants: "jobs@lever.co",
    latestAt: d("2026-05-29T09:22:00Z"),
    messageCount: 1,
    snippet: "You have a new application from Jordan Kim for the Senior Software Engineer role.",
    unread: false,
    folderId: "hiring",
    status: "sorted",
    confidence: 0.98,
    reasoning: "Automated email from Lever (ATS). Subject and sender clearly indicate a job application for an open role.",
    alternativeFolder: null,
    messages: [
      {
        id: "m3a",
        fromName: "Lever",
        fromEmail: "jobs@lever.co",
        time: d("2026-05-29T09:22:00Z"),
        snippet: "New application from Jordan Kim.",
        bodyText: "You have a new application from Jordan Kim for the Senior Software Engineer role.\n\nView the application in your Lever dashboard.",
      },
    ],
    hasDraft: false,
    isDrafting: false,
    lastSenderEmail: "jobs@lever.co",
    doneMark: null,
  },
  {
    id: "t4",
    subject: "Re: Product feedback — onboarding flow",
    providerThreadId: "p4",
    participants: "priya.nair@startupco.io",
    latestAt: d("2026-05-28T14:10:00Z"),
    messageCount: 4,
    snippet: "The new onboarding is much smoother. We hit one issue with the Gmail OAuth redirect on Safari.",
    unread: false,
    folderId: "customers-smb",
    status: "sorted",
    confidence: 0.93,
    reasoning: "Ongoing thread with a self-serve customer discussing product experience. Startup domain and tone match the SMB folder.",
    alternativeFolder: null,
    messages: [
      {
        id: "m4a",
        fromName: "Priya Nair",
        fromEmail: "priya.nair@startupco.io",
        time: d("2026-05-28T14:10:00Z"),
        snippet: "The new onboarding is much smoother.",
        bodyText: "Hey,\n\nThanks for the update! The new onboarding is much smoother. We hit one issue though — the Gmail OAuth redirect fails on Safari 17.4. Chrome works fine.\n\nOtherwise really happy with the product.\n\nPriya",
      },
    ],
    hasDraft: true,
    isDrafting: false,
    lastSenderEmail: "priya.nair@startupco.io",
    doneMark: null,
  },
  {
    id: "t5",
    subject: "Lunch next week?",
    providerThreadId: "p5",
    participants: "dan@dan.io",
    latestAt: d("2026-05-27T18:33:00Z"),
    messageCount: 1,
    snippet: "Hey, in SF next week. Any chance you're free for lunch on Tuesday or Wednesday?",
    unread: false,
    folderId: "other",
    status: "review",
    confidence: 0.52,
    reasoning: "Personal scheduling email. No clear business context — could belong to multiple folders. Routed to Other with low confidence.",
    alternativeFolder: { folderId: "customers-smb", name: "SMB", weight: 0.28 },
    messages: [
      {
        id: "m5a",
        fromName: "Dan",
        fromEmail: "dan@dan.io",
        time: d("2026-05-27T18:33:00Z"),
        snippet: "In SF next week — free for lunch?",
        bodyText: "Hey,\n\nIn SF next week for a few days. Any chance you're free for lunch on Tuesday or Wednesday? Would love to catch up.\n\nDan",
      },
    ],
    hasDraft: false,
    isDrafting: false,
    lastSenderEmail: "dan@dan.io",
    doneMark: null,
  },
  {
    id: "t6",
    subject: "Board meeting prep — May 2026",
    providerThreadId: "p6",
    participants: "lisa.monroe@ventures.com",
    latestAt: d("2026-05-26T11:00:00Z"),
    messageCount: 2,
    snippet: "Attached is the board pack template. Please fill in slides 4–9 before Thursday EOD.",
    unread: false,
    folderId: "investors-current",
    status: "sorted",
    confidence: 0.91,
    reasoning: "Board meeting prep from a known fund partner. Sender domain and context clearly match the Current investors folder.",
    alternativeFolder: null,
    messages: [
      {
        id: "m6a",
        fromName: "Lisa Monroe",
        fromEmail: "lisa.monroe@ventures.com",
        time: d("2026-05-26T11:00:00Z"),
        snippet: "Board pack template attached.",
        bodyText: "Hi,\n\nAttached is the board pack template for the May board meeting. Please fill in slides 4–9 before Thursday EOD.\n\nLet me know if you have questions.\n\nLisa",
      },
    ],
    hasDraft: false,
    isDrafting: false,
    lastSenderEmail: "lisa.monroe@ventures.com",
    doneMark: null,
  },
];
