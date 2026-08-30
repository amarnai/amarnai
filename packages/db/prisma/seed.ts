import bcrypt from "bcryptjs";
import {
  PrismaClient,
  Prisma,
  WorkspaceRole,
  Provider,
  EmailAddressIdentityKind,
  TagSource,
  EmailTagSource,
  Priority,
  Urgency,
  RiskLevel,
  RequiredAction,
  Sensitivity,
  SuggestedNextStep,
  AuditActorType,
} from "@prisma/client";

const db = new PrismaClient();

async function main() {
  console.log("Seeding database...");

  // ── 1. User ───────────────────────────────────────────────────────────────
  const user = await db.user.upsert({
    where: { email: "dev@aziru.local" },
    update: {},
    create: {
      email: "dev@aziru.local",
      name: "Aziru Dev User",
      emailVerified: new Date(),
    },
  });

  // ── 1b. Dev password credential ───────────────────────────────────────────
  // Lets the dev user sign in with email + password locally (e.g. the mobile
  // app, which has no Google OAuth in dev). Dev-only convenience: this is a
  // sign-in-able account with a trivial password, so it must never exist in a
  // production database. Hard-refuse when NODE_ENV is production rather than
  // relying on "don't run seed in prod" by convention. update:{} keeps
  // re-seeding idempotent.
  if (process.env.NODE_ENV === "production") {
    console.log("  Skipping dev login credential (NODE_ENV=production)");
  } else {
    const DEV_PASSWORD = "password";
    await db.userCredential.upsert({
      where: { userId: user.id },
      update: {},
      create: { userId: user.id, passwordHash: bcrypt.hashSync(DEV_PASSWORD, 10) },
    });
    console.log(`  Dev login: dev@aziru.local / ${DEV_PASSWORD}`);
  }

  // ── 2. Workspace ──────────────────────────────────────────────────────────
  let workspace = await db.workspace.findFirst({
    where: { name: "Default Workspace", ownerUserId: user.id },
  });
  if (!workspace) {
    workspace = await db.workspace.create({
      data: { name: "Default Workspace", ownerUserId: user.id },
    });
  }
  const workspaceId = workspace.id;

  // ── 3. WorkspaceMember ────────────────────────────────────────────────────
  await db.workspaceMember.upsert({
    where: { workspaceId_userId: { workspaceId, userId: user.id } },
    update: {},
    create: { workspaceId, userId: user.id, role: WorkspaceRole.OWNER },
  });

  // ── 4. EmailAccount ───────────────────────────────────────────────────────
  const emailAccount = await db.emailAccount.upsert({
    where: {
      workspaceId_providerAccountId: {
        workspaceId,
        providerAccountId: "gmail-demo-account-001",
      },
    },
    update: {},
    create: {
      workspaceId,
      userId: user.id,
      provider: Provider.GMAIL,
      primaryEmailAddress: "dev@aziru.local",
      providerAccountId: "gmail-demo-account-001",
      accessTokenEncrypted: "enc:seed-fake-access-token-aes256",
      refreshTokenEncrypted: "enc:seed-fake-refresh-token-aes256",
      tokenExpiresAt: new Date("2099-01-01T00:00:00Z"),
    },
  });

  // ── 5. EmailAddressIdentities ─────────────────────────────────────────────
  const identityDefs = [
    {
      emailAddress: "dev@aziru.local",
      displayName: "Aziru Dev User",
      kind: EmailAddressIdentityKind.PRIMARY,
      isPrimary: true,
    },
    {
      emailAddress: "billing@aziru.local",
      displayName: "Demo Billing",
      kind: EmailAddressIdentityKind.ALIAS,
      isPrimary: false,
    },
    {
      emailAddress: "clients@aziru.local",
      displayName: "Demo Clients",
      kind: EmailAddressIdentityKind.ALIAS,
      isPrimary: false,
    },
  ];

  for (const def of identityDefs) {
    await db.emailAddressIdentity.upsert({
      where: {
        emailAccountId_emailAddress: {
          emailAccountId: emailAccount.id,
          emailAddress: def.emailAddress,
        },
      },
      update: {},
      create: { emailAccountId: emailAccount.id, ...def },
    });
  }

  // ── 6. TaxonomyNodes ──────────────────────────────────────────────────────
  async function findOrCreateNode(params: {
    name: string;
    description?: string;
    isRoot?: boolean;
    positionX: number;
    positionY: number;
  }) {
    const existing = await db.taxonomyNode.findFirst({
      where: { workspaceId, name: params.name },
    });
    if (existing) {
      if (params.isRoot && !existing.isRoot) {
        return db.taxonomyNode.update({
          where: { id: existing.id },
          data: { isRoot: true },
        });
      }
      return existing;
    }
    return db.taxonomyNode.create({
      data: {
        workspaceId,
        name: params.name,
        description: params.description ?? null,
        isRoot: params.isRoot ?? false,
        positionX: params.positionX,
        positionY: params.positionY,
      },
    });
  }

  // Root
  const nodeInbox = await findOrCreateNode({
    name: "Inbox",
    isRoot: true,
    positionX: 0,
    positionY: 0,
  });

  // ── Revenue branch ────────────────────────────────────────────────────────

  const nodeSales = await findOrCreateNode({
    name: "Sales / new business",
    description:
      "Inbound sales inquiries, demo requests, pricing questions, and new-business leads from prospective customers.",
    positionX: -750,
    positionY: -300,
  });

  const nodeBilling = await findOrCreateNode({
    name: "Billing / invoices",
    description:
      "Invoices, payment issues, billing disputes, refunds, and subscription renewal questions from existing customers.",
    positionX: -500,
    positionY: -300,
  });

  const nodePartnerships = await findOrCreateNode({
    name: "Partnerships / vendors",
    description:
      "Partnership proposals, integration and reseller offers, and correspondence with vendors and suppliers.",
    positionX: -250,
    positionY: -300,
  });

  const nodePress = await findOrCreateNode({
    name: "Press / media",
    description:
      "Journalist interview requests, press inquiries, analyst briefings, and media relations correspondence.",
    positionX: 0,
    positionY: -300,
  });

  // ── Operations branch ──────────────────────────────────────────────────────

  const nodeSupport = await findOrCreateNode({
    name: "Customer support",
    description:
      "Product issues, bug reports, how-to questions, and technical support requests from existing customers.",
    positionX: 250,
    positionY: -300,
  });

  const nodeRecruiting = await findOrCreateNode({
    name: "Recruiting / HR",
    description:
      "Job applications, candidate correspondence, recruiter outreach, and hiring-related communication.",
    positionX: 500,
    positionY: -300,
  });

  const nodeMeetings = await findOrCreateNode({
    name: "Meetings / scheduling",
    description:
      "Meeting requests, scheduling and rescheduling, calendar invitations, and availability confirmations.",
    positionX: 750,
    positionY: -300,
  });

  const nodeLegal = await findOrCreateNode({
    name: "Legal / compliance",
    description:
      "Contracts, NDAs, data processing agreements, compliance questionnaires, and legal review requests.",
    positionX: 1000,
    positionY: -300,
  });

  const nodeInternal = await findOrCreateNode({
    name: "Internal / operations",
    description:
      "Internal team correspondence and general operational matters that do not fit a more specific category.",
    positionX: 1250,
    positionY: -300,
  });

  // ── Catch-all ─────────────────────────────────────────────────────────────

  const nodeOtherReview = await findOrCreateNode({
    name: "Other / needs review",
    description:
      "Email that does not clearly fit any of the defined categories and requires human review.",
    positionX: 0,
    positionY: 300,
  });

  // ── 7. TaxonomyEdges ──────────────────────────────────────────────────────
  async function findOrCreateEdge(params: {
    sourceNodeId: string;
    targetNodeId: string;
  }) {
    const existing = await db.taxonomyEdge.findFirst({
      where: { workspaceId, sourceNodeId: params.sourceNodeId, targetNodeId: params.targetNodeId },
    });
    if (existing) return existing;
    return db.taxonomyEdge.create({
      data: {
        workspaceId,
        sourceNodeId: params.sourceNodeId,
        targetNodeId: params.targetNodeId,
      },
    });
  }

  // Inbox → all destination nodes
  await findOrCreateEdge({ sourceNodeId: nodeInbox.id, targetNodeId: nodeSales.id });
  await findOrCreateEdge({ sourceNodeId: nodeInbox.id, targetNodeId: nodeBilling.id });
  await findOrCreateEdge({ sourceNodeId: nodeInbox.id, targetNodeId: nodePartnerships.id });
  await findOrCreateEdge({ sourceNodeId: nodeInbox.id, targetNodeId: nodePress.id });
  await findOrCreateEdge({ sourceNodeId: nodeInbox.id, targetNodeId: nodeSupport.id });
  await findOrCreateEdge({ sourceNodeId: nodeInbox.id, targetNodeId: nodeRecruiting.id });
  await findOrCreateEdge({ sourceNodeId: nodeInbox.id, targetNodeId: nodeMeetings.id });
  await findOrCreateEdge({ sourceNodeId: nodeInbox.id, targetNodeId: nodeLegal.id });
  await findOrCreateEdge({ sourceNodeId: nodeInbox.id, targetNodeId: nodeInternal.id });
  await findOrCreateEdge({ sourceNodeId: nodeInbox.id, targetNodeId: nodeOtherReview.id });

  // ── 8. Tags ───────────────────────────────────────────────────────────────
  const tagDefs = [
    { name: "Revenue", color: "#8B5CF6" },
    { name: "Customer", color: "#F59E0B" },
    { name: "Press", color: "#3B82F6" },
    { name: "Operations", color: "#10B981" },
  ] as const;

  const tags: Record<string, string> = {};
  for (const def of tagDefs) {
    const tag = await db.tag.upsert({
      where: { workspaceId_name: { workspaceId, name: def.name } },
      update: {},
      create: {
        workspaceId,
        name: def.name,
        color: def.color,
        source: TagSource.AMARNAI,
      },
    });
    tags[def.name] = tag.id;
  }

  // ── 9. Email Threads and Messages ─────────────────────────────────────────
  async function findOrCreateThread(params: {
    providerThreadId: string;
    providerMessageId: string;
    subject: string;
    senderEmail: string;
    senderName: string;
    snippet: string;
    bodyText: string;
    receivedAt: Date;
    toEmails: string[];
    hasAttachments?: boolean;
    triageStatus?: "PENDING" | "SORTED" | "NEEDS_REVIEW";
  }) {
    const thread = await db.emailThread.upsert({
      where: {
        emailAccountId_providerThreadId: {
          emailAccountId: emailAccount.id,
          providerThreadId: params.providerThreadId,
        },
      },
      update: {},
      create: {
        workspaceId,
        emailAccountId: emailAccount.id,
        provider: Provider.GMAIL,
        providerThreadId: params.providerThreadId,
        subject: params.subject,
        latestMessageAt: params.receivedAt,
        messageCount: 1,
        triageStatus: params.triageStatus ?? "PENDING",
      },
    });

    const message = await db.emailMessage.upsert({
      where: {
        emailAccountId_providerMessageId: {
          emailAccountId: emailAccount.id,
          providerMessageId: params.providerMessageId,
        },
      },
      update: {},
      create: {
        workspaceId,
        emailAccountId: emailAccount.id,
        emailThreadId: thread.id,
        providerMessageId: params.providerMessageId,
        senderEmail: params.senderEmail,
        senderName: params.senderName,
        toEmails: params.toEmails,
        ccEmails: [],
        bccEmails: [],
        subject: params.subject,
        snippet: params.snippet,
        bodyText: params.bodyText,
        receivedAt: params.receivedAt,
        hasAttachments: params.hasAttachments ?? false,
      },
    });

    return { thread, message };
  }

  // 1. Inbound sales inquiry → Sales / new business
  const { thread: threadSales, message: msgSales } =
    await findOrCreateThread({
      triageStatus: "SORTED",
      providerThreadId: "thread-001",
      providerMessageId: "msg-001",
      subject: "Interested in your platform — pricing for a 50-person team",
      senderEmail: "jordan.mills@brightwave.example",
      senderName: "Jordan Mills",
      snippet:
        "We are evaluating tools for our operations team and would like to understand your pricing for around 50 seats.",
      bodyText: [
        "Hello,",
        "",
        "I lead operations at Brightwave and we are evaluating a few platforms for our team this quarter. We would likely start with around 50 seats.",
        "",
        "Could you share pricing for that team size and let me know whether a short demo is possible next week?",
        "",
        "Best regards,",
        "Jordan Mills",
      ].join("\n"),
      receivedAt: new Date("2026-05-17T10:30:00Z"),
      toEmails: ["demo@aziru.local"],
    });

  // 2. Customer support issue → Customer support
  const { thread: threadSupport, message: msgSupport } =
    await findOrCreateThread({
      triageStatus: "SORTED",
      providerThreadId: "thread-002",
      providerMessageId: "msg-002",
      subject: "Sync stopped working this morning — urgent",
      senderEmail: "david.chen@northstar-retail.example",
      senderName: "David Chen",
      snippet:
        "Our account stopped syncing around 8am and the team is blocked. Can someone look into this today?",
      bodyText: [
        "Hi support,",
        "",
        "Our workspace stopped syncing this morning at about 8am. New items are not coming through and the whole team is blocked on it.",
        "",
        "This is affecting our daily operations, so a quick response today would be greatly appreciated.",
        "",
        "Thanks,",
        "David Chen",
      ].join("\n"),
      receivedAt: new Date("2026-05-16T08:00:00Z"),
      toEmails: ["demo@aziru.local"],
    });

  // 3. Partnership proposal → Partnerships / vendors
  const { thread: threadPartnership, message: msgPartnership } =
    await findOrCreateThread({
      triageStatus: "SORTED",
      providerThreadId: "thread-003",
      providerMessageId: "msg-003",
      subject: "Partnership proposal: integration + co-marketing",
      senderEmail: "sarah.bennett@meridianapps.example",
      senderName: "Sarah Bennett",
      snippet:
        "We build a complementary product and would like to explore a technical integration and joint go-to-market.",
      bodyText: [
        "Hello,",
        "",
        "I head up partnerships at Meridian Apps. We build a complementary product to yours, and several shared customers have asked us to work together.",
        "",
        "We would like to explore a technical integration and a co-marketing arrangement. Would you be open to a call to discuss?",
        "",
        "Best,",
        "Sarah Bennett",
      ].join("\n"),
      receivedAt: new Date("2026-05-15T14:20:00Z"),
      toEmails: ["demo@aziru.local"],
    });

  // 4. Billing dispute → Billing / invoices
  const { thread: threadBilling, message: msgBilling } =
    await findOrCreateThread({
      triageStatus: "SORTED",
      providerThreadId: "thread-004",
      providerMessageId: "msg-004",
      subject: "Invoice #2026-0481 — duplicate charge on our card",
      senderEmail: "peter.simmons@harborlogistics.example",
      senderName: "Peter Simmons",
      snippet:
        "We were charged twice for invoice #2026-0481 this month. Can you confirm and issue a refund for the duplicate?",
      bodyText: [
        "Hello,",
        "",
        "It looks like we were charged twice for invoice #2026-0481 this billing cycle. Both charges hit the same card within a day of each other.",
        "",
        "Could you confirm the duplicate charge and issue a refund for the second one?",
        "",
        "Thanks,",
        "Peter Simmons",
      ].join("\n"),
      receivedAt: new Date("2026-05-14T09:45:00Z"),
      toEmails: ["demo@aziru.local"],
    });

  // 5. Press interview request → Press / media
  const { thread: threadInterview, message: msgInterview } =
    await findOrCreateThread({
      triageStatus: "SORTED",
      providerThreadId: "thread-005",
      providerMessageId: "msg-005",
      subject: "Interview request — feature on email automation tools",
      senderEmail: "amelia.rivera@techsignal.example",
      senderName: "Amelia Rivera — TechSignal",
      snippet:
        "I'm writing a feature on email automation tools and would love to include your perspective. Could we talk this week?",
      bodyText: [
        "Hello,",
        "",
        "I'm a reporter at TechSignal working on a feature about email automation tools and how teams are adopting them.",
        "",
        "I'd love to include your perspective. Would you be available for a 30-minute interview this week? The piece is scheduled to run on June 14.",
        "",
        "Thank you,",
        "Amelia Rivera",
      ].join("\n"),
      receivedAt: new Date("2026-05-17T16:00:00Z"),
      toEmails: ["demo@aziru.local"],
    });

  // 6. Vague follow-up → Other / needs review (low confidence)
  const { thread: threadVague, message: msgVague } =
    await findOrCreateThread({
      triageStatus: "NEEDS_REVIEW",
      providerThreadId: "thread-006",
      providerMessageId: "msg-006",
      subject: "Following up",
      senderEmail: "contact@unknown-domain.example",
      senderName: "M. Marsh",
      snippet:
        "As discussed, I'm circling back. Let me know how you'd like to proceed.",
      bodyText: [
        "Hello,",
        "",
        "As discussed, I'm circling back on this. Let me know how you'd like to proceed from here.",
        "",
        "Regards,",
        "M. Marsh",
      ].join("\n"),
      receivedAt: new Date("2026-05-17T07:30:00Z"),
      toEmails: ["demo@aziru.local"],
    });

  // ── 10. EmailClassifications ──────────────────────────────────────────────
  type PathStep = { edgeId?: string; nodeId: string; nodeName: string };

  async function findOrCreateClassification(params: {
    emailThreadId: string;
    emailMessageId: string;
    finalNodeId: string;
    path: PathStep[];
    confidence: number;
    explanation: string;
    priority: Priority;
    urgency: Urgency;
    riskLevel: RiskLevel;
    requiredAction: RequiredAction;
    sensitivity: Sensitivity;
    dueAt?: Date;
    suggestedNextStep: SuggestedNextStep;
    needsHumanReview: boolean;
  }) {
    const existing = await db.emailClassification.findFirst({
      where: {
        emailThreadId: params.emailThreadId,
        finalNodeId: params.finalNodeId,
      },
    });
    if (existing) return existing;
    return db.emailClassification.create({
      data: {
        workspaceId,
        emailThreadId: params.emailThreadId,
        emailMessageId: params.emailMessageId,
        finalNodeId: params.finalNodeId,
        path: params.path as Prisma.InputJsonArray,
        confidence: params.confidence,
        explanation: params.explanation,
        priority: params.priority,
        urgency: params.urgency,
        riskLevel: params.riskLevel,
        requiredAction: params.requiredAction,
        sensitivity: params.sensitivity,
        suggestedNextStep: params.suggestedNextStep,
        needsHumanReview: params.needsHumanReview,
        modelProvider: "seed",
        modelName: "static",
        promptVersion: "v0-seed",
        ...(params.dueAt != null ? { dueAt: params.dueAt } : {}),
      },
    });
  }

  // Sales inquiry → Inbox → Sales / new business
  const classSales = await findOrCreateClassification({
    emailThreadId: threadSales.id,
    emailMessageId: msgSales.id,
    finalNodeId: nodeSales.id,
    path: [
      { nodeId: nodeInbox.id, nodeName: "Inbox" },
      { nodeId: nodeSales.id, nodeName: "Sales / new business" },
    ],
    confidence: 0.93,
    explanation:
      "Prospective customer evaluating the product asks for pricing at a named team size and requests a demo. Clear inbound sales lead.",
    priority: Priority.MEDIUM,
    urgency: Urgency.SOON,
    riskLevel: RiskLevel.LOW,
    requiredAction: RequiredAction.REPLY,
    sensitivity: Sensitivity.NORMAL,
    suggestedNextStep: SuggestedNextStep.OPEN_IN_GMAIL,
    needsHumanReview: false,
  });

  // Support issue → Inbox → Customer support
  const classSupport = await findOrCreateClassification({
    emailThreadId: threadSupport.id,
    emailMessageId: msgSupport.id,
    finalNodeId: nodeSupport.id,
    path: [
      { nodeId: nodeInbox.id, nodeName: "Inbox" },
      { nodeId: nodeSupport.id, nodeName: "Customer support" },
    ],
    confidence: 0.95,
    explanation:
      "Existing customer reports a sync outage blocking their team since this morning. Time-sensitive technical support issue.",
    priority: Priority.HIGH,
    urgency: Urgency.TODAY,
    riskLevel: RiskLevel.LOW,
    requiredAction: RequiredAction.REPLY,
    sensitivity: Sensitivity.NORMAL,
    suggestedNextStep: SuggestedNextStep.OPEN_IN_GMAIL,
    needsHumanReview: false,
  });

  // Partnership proposal → Inbox → Partnerships / vendors
  const classPartnership = await findOrCreateClassification({
    emailThreadId: threadPartnership.id,
    emailMessageId: msgPartnership.id,
    finalNodeId: nodePartnerships.id,
    path: [
      { nodeId: nodeInbox.id, nodeName: "Inbox" },
      { nodeId: nodePartnerships.id, nodeName: "Partnerships / vendors" },
    ],
    confidence: 0.91,
    explanation:
      "Partnerships lead from a complementary vendor proposing a technical integration and co-marketing. Subject and body both reference partnership intent.",
    priority: Priority.MEDIUM,
    urgency: Urgency.NONE,
    riskLevel: RiskLevel.LOW,
    requiredAction: RequiredAction.REPLY,
    sensitivity: Sensitivity.NORMAL,
    suggestedNextStep: SuggestedNextStep.LABEL_ONLY,
    needsHumanReview: false,
  });

  // Billing dispute → Inbox → Billing / invoices
  const classBilling = await findOrCreateClassification({
    emailThreadId: threadBilling.id,
    emailMessageId: msgBilling.id,
    finalNodeId: nodeBilling.id,
    path: [
      { nodeId: nodeInbox.id, nodeName: "Inbox" },
      { nodeId: nodeBilling.id, nodeName: "Billing / invoices" },
    ],
    confidence: 0.88,
    explanation:
      "Customer reports a duplicate charge for a named invoice number and requests a refund. Clear billing issue.",
    priority: Priority.LOW,
    urgency: Urgency.SOON,
    riskLevel: RiskLevel.LOW,
    requiredAction: RequiredAction.REPLY,
    sensitivity: Sensitivity.PERSONAL_DATA,
    suggestedNextStep: SuggestedNextStep.LABEL_ONLY,
    needsHumanReview: false,
  });

  // Press interview → Inbox → Press / media
  const classInterview = await findOrCreateClassification({
    emailThreadId: threadInterview.id,
    emailMessageId: msgInterview.id,
    finalNodeId: nodePress.id,
    path: [
      { nodeId: nodeInbox.id, nodeName: "Inbox" },
      { nodeId: nodePress.id, nodeName: "Press / media" },
    ],
    confidence: 0.89,
    explanation:
      "Reporter requesting an interview for a named publication with a stated run date. Clear press/media request.",
    priority: Priority.MEDIUM,
    urgency: Urgency.SOON,
    riskLevel: RiskLevel.LOW,
    requiredAction: RequiredAction.REPLY,
    sensitivity: Sensitivity.NORMAL,
    suggestedNextStep: SuggestedNextStep.LABEL_ONLY,
    needsHumanReview: false,
  });

  // Vague follow-up → Inbox → Other / needs review (low confidence)
  const classVague = await findOrCreateClassification({
    emailThreadId: threadVague.id,
    emailMessageId: msgVague.id,
    finalNodeId: nodeOtherReview.id,
    path: [
      { nodeId: nodeInbox.id, nodeName: "Inbox" },
      { nodeId: nodeOtherReview.id, nodeName: "Other / needs review" },
    ],
    confidence: 0.29,
    explanation:
      "Vague subject and body. Unknown sender. No context about the account, product, or any specific topic. Cannot classify with confidence.",
    priority: Priority.MEDIUM,
    urgency: Urgency.UNKNOWN,
    riskLevel: RiskLevel.MEDIUM,
    requiredAction: RequiredAction.UNKNOWN,
    sensitivity: Sensitivity.NORMAL,
    suggestedNextStep: SuggestedNextStep.ASK_USER,
    needsHumanReview: true,
  });

  // ── 11. EmailTags ─────────────────────────────────────────────────────────
  async function findOrCreateEmailTag(params: {
    emailThreadId: string;
    tagId: string;
    source: EmailTagSource;
  }) {
    const existing = await db.emailTag.findFirst({
      where: { emailThreadId: params.emailThreadId, tagId: params.tagId },
    });
    if (!existing) {
      await db.emailTag.create({ data: params });
    }
  }

  await findOrCreateEmailTag({
    emailThreadId: threadSales.id,
    tagId: tags["Revenue"]!,
    source: EmailTagSource.AI_SUGGESTED,
  });
  await findOrCreateEmailTag({
    emailThreadId: threadPartnership.id,
    tagId: tags["Revenue"]!,
    source: EmailTagSource.AI_SUGGESTED,
  });
  await findOrCreateEmailTag({
    emailThreadId: threadSupport.id,
    tagId: tags["Customer"]!,
    source: EmailTagSource.AI_SUGGESTED,
  });
  await findOrCreateEmailTag({
    emailThreadId: threadBilling.id,
    tagId: tags["Customer"]!,
    source: EmailTagSource.USER,
  });
  await findOrCreateEmailTag({
    emailThreadId: threadInterview.id,
    tagId: tags["Press"]!,
    source: EmailTagSource.AI_SUGGESTED,
  });
  await findOrCreateEmailTag({
    emailThreadId: threadVague.id,
    tagId: tags["Operations"]!,
    source: EmailTagSource.AI_SUGGESTED,
  });

  // ── 12. AuditLog entries ──────────────────────────────────────────────────
  async function findOrCreateAuditLog(params: {
    actorType: AuditActorType;
    actorUserId?: string;
    eventType: string;
    entityType: string;
    entityId: string;
    metadata: Prisma.InputJsonObject;
  }) {
    const existing = await db.auditLog.findFirst({
      where: { workspaceId, eventType: params.eventType, entityId: params.entityId },
    });
    if (existing) return;
    await db.auditLog.create({
      data: {
        workspaceId,
        actorType: params.actorType,
        eventType: params.eventType,
        entityType: params.entityType,
        entityId: params.entityId,
        metadata: params.metadata,
        ...(params.actorUserId != null ? { actorUserId: params.actorUserId } : {}),
      },
    });
  }

  await findOrCreateAuditLog({
    actorType: AuditActorType.AI,
    eventType: "email.classified",
    entityType: "EmailClassification",
    entityId: classSales.id,
    metadata: { confidence: 0.93, finalNodeName: "Sales / new business", needsHumanReview: false },
  });

  await findOrCreateAuditLog({
    actorType: AuditActorType.AI,
    eventType: "email.classified",
    entityType: "EmailClassification",
    entityId: classSupport.id,
    metadata: { confidence: 0.95, finalNodeName: "Customer support", needsHumanReview: false },
  });

  await findOrCreateAuditLog({
    actorType: AuditActorType.AI,
    eventType: "email.classified",
    entityType: "EmailClassification",
    entityId: classPartnership.id,
    metadata: { confidence: 0.91, finalNodeName: "Partnerships / vendors", needsHumanReview: false },
  });

  await findOrCreateAuditLog({
    actorType: AuditActorType.AI,
    eventType: "email.classified",
    entityType: "EmailClassification",
    entityId: classBilling.id,
    metadata: { confidence: 0.88, finalNodeName: "Billing / invoices", needsHumanReview: false },
  });

  await findOrCreateAuditLog({
    actorType: AuditActorType.AI,
    eventType: "email.classified",
    entityType: "EmailClassification",
    entityId: classInterview.id,
    metadata: { confidence: 0.89, finalNodeName: "Press / media", needsHumanReview: false },
  });

  await findOrCreateAuditLog({
    actorType: AuditActorType.AI,
    eventType: "email.classified",
    entityType: "EmailClassification",
    entityId: classVague.id,
    metadata: { confidence: 0.29, finalNodeName: "Other / needs review", needsHumanReview: true },
  });

  console.log("Done.");
}

main()
  .then(() => db.$disconnect())
  .catch(async (e) => {
    console.error("Seed failed:", e instanceof Error ? e.message : String(e));
    await db.$disconnect();
    process.exit(1);
  });
