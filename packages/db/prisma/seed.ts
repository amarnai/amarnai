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
  ReviewStatus,
  AuditActorType,
} from "@prisma/client";

const db = new PrismaClient();

async function main() {
  console.log("Seeding database...");

  // ── 1. User ───────────────────────────────────────────────────────────────
  const user = await db.user.upsert({
    where: { email: "demo@genizor.local" },
    update: {},
    create: {
      email: "demo@genizor.local",
      name: "Demo User",
    },
  });

  // ── 2. Workspace ──────────────────────────────────────────────────────────
  let workspace = await db.workspace.findFirst({
    where: { name: "Demo Workspace", ownerUserId: user.id },
  });
  if (!workspace) {
    workspace = await db.workspace.create({
      data: { name: "Demo Workspace", ownerUserId: user.id },
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
      primaryEmailAddress: "demo@genizor.local",
      providerAccountId: "gmail-demo-account-001",
      accessTokenEncrypted: "enc:seed-fake-access-token-aes256",
      refreshTokenEncrypted: "enc:seed-fake-refresh-token-aes256",
      tokenExpiresAt: new Date("2099-01-01T00:00:00Z"),
    },
  });

  // ── 5. EmailAddressIdentities ─────────────────────────────────────────────
  const identityDefs = [
    {
      emailAddress: "demo@genizor.local",
      displayName: "Demo User",
      kind: EmailAddressIdentityKind.PRIMARY,
      isPrimary: true,
    },
    {
      emailAddress: "billing@genizor.local",
      displayName: "Demo Billing",
      kind: EmailAddressIdentityKind.ALIAS,
      isPrimary: false,
    },
    {
      emailAddress: "clients@genizor.local",
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
    description: string;
    isRoot?: boolean;
    isVisibleCategory: boolean;
    canReceiveEmails: boolean;
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
        description: params.description,
        isRoot: params.isRoot ?? false,
        isVisibleCategory: params.isVisibleCategory,
        canReceiveEmails: params.canReceiveEmails,
        positionX: params.positionX,
        positionY: params.positionY,
      },
    });
  }

  const nodeInbox = await findOrCreateNode({
    name: "Inbox",
    description: "Top-level entry point for all incoming email",
    isRoot: true,
    isVisibleCategory: false,
    canReceiveEmails: false,
    positionX: 0,
    positionY: 0,
  });

  const nodeClients = await findOrCreateNode({
    name: "Clients",
    description: "Emails from clients, prospects, or project stakeholders",
    isVisibleCategory: true,
    canReceiveEmails: true,
    positionX: 300,
    positionY: -200,
  });

  const nodeUrgent = await findOrCreateNode({
    name: "Urgent",
    description: "Emails requiring same-day action, escalation, or unblocking",
    isVisibleCategory: true,
    canReceiveEmails: true,
    positionX: 600,
    positionY: -300,
  });

  const nodeFinance = await findOrCreateNode({
    name: "Finance",
    description: "Sorting step for billing, invoices, payments, and financial admin",
    isVisibleCategory: false,
    canReceiveEmails: false,
    positionX: 300,
    positionY: 100,
  });

  const nodeInvoices = await findOrCreateNode({
    name: "Invoices",
    description: "Invoices, receipts, payment requests, and billing documents",
    isVisibleCategory: true,
    canReceiveEmails: true,
    positionX: 600,
    positionY: 0,
  });

  const nodeApprovalNeeded = await findOrCreateNode({
    name: "Approval Needed",
    description: "Invoices or payment requests that require explicit approval",
    isVisibleCategory: true,
    canReceiveEmails: true,
    positionX: 900,
    positionY: 50,
  });

  const nodePersonal = await findOrCreateNode({
    name: "Personal",
    description: "Personal or non-work email",
    isVisibleCategory: true,
    canReceiveEmails: true,
    positionX: 300,
    positionY: 350,
  });

  // ── 7. TaxonomyEdges ──────────────────────────────────────────────────────
  async function findOrCreateEdge(params: {
    sourceNodeId: string;
    targetNodeId: string;
    sortingQuestion: string;
    priority?: number;
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
        sortingQuestion: params.sortingQuestion,
        priority: params.priority ?? 0,
      },
    });
  }

  await findOrCreateEdge({
    sourceNodeId: nodeInbox.id,
    targetNodeId: nodeClients.id,
    sortingQuestion:
      "Is this email from, about, or intended for a client, prospect, or project stakeholder?",
    priority: 0,
  });

  await findOrCreateEdge({
    sourceNodeId: nodeClients.id,
    targetNodeId: nodeUrgent.id,
    sortingQuestion:
      "Does this require same-day action, escalation, or unblock someone?",
    priority: 0,
  });

  await findOrCreateEdge({
    sourceNodeId: nodeInbox.id,
    targetNodeId: nodeFinance.id,
    sortingQuestion:
      "Is this email about billing, invoices, payments, receipts, or financial admin?",
    priority: 1,
  });

  await findOrCreateEdge({
    sourceNodeId: nodeFinance.id,
    targetNodeId: nodeInvoices.id,
    sortingQuestion:
      "Is this specifically an invoice, receipt, payment request, or billing document?",
    priority: 0,
  });

  await findOrCreateEdge({
    sourceNodeId: nodeInvoices.id,
    targetNodeId: nodeApprovalNeeded.id,
    sortingQuestion:
      "Does this invoice or payment request require approval before action?",
    priority: 0,
  });

  await findOrCreateEdge({
    sourceNodeId: nodeInbox.id,
    targetNodeId: nodePersonal.id,
    sortingQuestion: "Is this a personal or non-work email?",
    priority: 2,
  });

  // ── 8. Tags ───────────────────────────────────────────────────────────────
  const tagDefs = [
    { name: "VIP", color: "#FFD700" },
    { name: "Vendor", color: "#6366F1" },
    { name: "Accounting", color: "#10B981" },
    { name: "Personal", color: "#F59E0B" },
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
        source: TagSource.GENIZOR,
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

  // 1. Urgent client request
  const { thread: threadUrgentClient, message: msgUrgentClient } =
    await findOrCreateThread({
      providerThreadId: "thread-001",
      providerMessageId: "msg-001",
      subject: "URGENT: Production deployment blocked — need sign-off today",
      senderEmail: "alex.martin@acmecorp.example",
      senderName: "Alex Martin",
      snippet:
        "Our staging env is failing after yesterday's push. We need your approval to roll back before 5 PM or we miss the release window.",
      bodyText: [
        "Hi,",
        "",
        "Our staging environment started throwing 500 errors after yesterday's deployment. The team has identified the root cause but we need your explicit sign-off to roll back to v2.3.1 before end of business today.",
        "",
        "If we miss this window, the client release is blocked until next sprint.",
        "",
        "Please confirm ASAP.",
        "",
        "Alex",
      ].join("\n"),
      receivedAt: new Date("2026-05-17T09:15:00Z"),
      toEmails: ["demo@genizor.local"],
    });

  // 2. Invoice approval request
  const { thread: threadInvoice, message: msgInvoice } =
    await findOrCreateThread({
      providerThreadId: "thread-002",
      providerMessageId: "msg-002",
      subject: "Invoice #INV-2026-0042 — Approval required by May 20",
      senderEmail: "finance@supplierco.example",
      senderName: "SupplierCo Finance",
      snippet:
        "Please find attached Invoice #INV-2026-0042 for $8,400 due by May 20. Kindly approve for payment processing.",
      bodyText: [
        "Dear Demo,",
        "",
        "Please find attached Invoice #INV-2026-0042 for services rendered in April 2026.",
        "",
        "Amount: $8,400.00",
        "Due date: May 20, 2026",
        "Bank reference: SUP-2026-042",
        "",
        "Kindly approve this invoice so we can process payment before the due date.",
        "",
        "Thank you,",
        "SupplierCo Finance Team",
      ].join("\n"),
      receivedAt: new Date("2026-05-16T14:30:00Z"),
      hasAttachments: true,
      toEmails: ["billing@genizor.local"],
    });

  // 3. Personal email
  const { thread: threadPersonal, message: msgPersonal } =
    await findOrCreateThread({
      providerThreadId: "thread-003",
      providerMessageId: "msg-003",
      subject: "Weekend plans?",
      senderEmail: "sam.jones@gmail.com",
      senderName: "Sam Jones",
      snippet:
        "Are you free Saturday? We were thinking of doing a hike if the weather holds up.",
      bodyText: [
        "Hey!",
        "",
        "Are you free Saturday? We were thinking of doing a hike up to the ridge if the weather holds. Should be fun — Sophie and Tom are coming too.",
        "",
        "Let me know!",
        "Sam",
      ].join("\n"),
      receivedAt: new Date("2026-05-16T18:45:00Z"),
      toEmails: ["demo@genizor.local"],
    });

  // 4. Vendor FYI
  const { thread: threadVendorFYI, message: msgVendorFYI } =
    await findOrCreateThread({
      providerThreadId: "thread-004",
      providerMessageId: "msg-004",
      subject: "[FYI] New pricing tier effective June 1",
      senderEmail: "updates@vendorcloud.example",
      senderName: "VendorCloud Updates",
      snippet:
        "We're updating our pricing tiers starting June 1. Your current plan is unaffected.",
      bodyText: [
        "Hi Demo,",
        "",
        "We're rolling out updated pricing tiers on June 1, 2026. Your current Business plan pricing is locked in until your next renewal date.",
        "",
        "The key changes affect teams on the Starter and Enterprise tiers — see the attached summary for full details.",
        "",
        "No action needed on your end.",
        "",
        "The VendorCloud Team",
      ].join("\n"),
      receivedAt: new Date("2026-05-15T10:00:00Z"),
      toEmails: ["demo@genizor.local"],
    });

  // 5. Ambiguous / low-confidence email
  const { thread: threadAmbiguous, message: msgAmbiguous } =
    await findOrCreateThread({
      providerThreadId: "thread-005",
      providerMessageId: "msg-005",
      subject: "Following up",
      senderEmail: "unknown.sender@randomdomain.example",
      senderName: "J. Smith",
      snippet:
        "Just following up on our previous conversation. Please let me know if you have any questions.",
      bodyText: [
        "Hi,",
        "",
        "Just following up on our previous conversation. Please let me know if you have any questions or need anything further from my side.",
        "",
        "Best,",
        "J. Smith",
      ].join("\n"),
      receivedAt: new Date("2026-05-17T08:00:00Z"),
      toEmails: ["demo@genizor.local"],
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

  // Urgent client → routed through Inbox → Clients → Urgent
  const classUrgentClient = await findOrCreateClassification({
    emailThreadId: threadUrgentClient.id,
    emailMessageId: msgUrgentClient.id,
    finalNodeId: nodeUrgent.id,
    path: [
      { nodeId: nodeInbox.id, nodeName: "Inbox" },
      { nodeId: nodeClients.id, nodeName: "Clients" },
      { nodeId: nodeUrgent.id, nodeName: "Urgent" },
    ],
    confidence: 0.94,
    explanation:
      "Known client contact. Subject explicitly states urgency and a same-day deadline. Requires approval to unblock a release.",
    priority: Priority.HIGH,
    urgency: Urgency.TODAY,
    riskLevel: RiskLevel.MEDIUM,
    requiredAction: RequiredAction.APPROVE,
    sensitivity: Sensitivity.CONFIDENTIAL,
    suggestedNextStep: SuggestedNextStep.OPEN_IN_GMAIL,
    needsHumanReview: false,
  });

  // Invoice → routed through Inbox → Finance → Invoices → Approval Needed
  const classInvoice = await findOrCreateClassification({
    emailThreadId: threadInvoice.id,
    emailMessageId: msgInvoice.id,
    finalNodeId: nodeApprovalNeeded.id,
    path: [
      { nodeId: nodeInbox.id, nodeName: "Inbox" },
      { nodeId: nodeFinance.id, nodeName: "Finance" },
      { nodeId: nodeInvoices.id, nodeName: "Invoices" },
      { nodeId: nodeApprovalNeeded.id, nodeName: "Approval Needed" },
    ],
    confidence: 0.97,
    explanation:
      "Supplier invoice with specific amount ($8,400) and due date. Financial document requiring explicit approval before payment.",
    priority: Priority.HIGH,
    urgency: Urgency.SOON,
    riskLevel: RiskLevel.HIGH,
    requiredAction: RequiredAction.APPROVE,
    sensitivity: Sensitivity.FINANCIAL,
    dueAt: new Date("2026-05-20T00:00:00Z"),
    suggestedNextStep: SuggestedNextStep.ASK_USER,
    needsHumanReview: true,
  });

  // Personal → routed through Inbox → Personal
  await findOrCreateClassification({
    emailThreadId: threadPersonal.id,
    emailMessageId: msgPersonal.id,
    finalNodeId: nodePersonal.id,
    path: [
      { nodeId: nodeInbox.id, nodeName: "Inbox" },
      { nodeId: nodePersonal.id, nodeName: "Personal" },
    ],
    confidence: 0.91,
    explanation:
      "Casual tone, personal Gmail address, social plans. No professional or financial content.",
    priority: Priority.LOW,
    urgency: Urgency.NONE,
    riskLevel: RiskLevel.LOW,
    requiredAction: RequiredAction.REPLY,
    sensitivity: Sensitivity.PERSONAL_DATA,
    suggestedNextStep: SuggestedNextStep.LABEL_ONLY,
    needsHumanReview: false,
  });

  // Vendor FYI → routed through Inbox → Clients
  await findOrCreateClassification({
    emailThreadId: threadVendorFYI.id,
    emailMessageId: msgVendorFYI.id,
    finalNodeId: nodeClients.id,
    path: [
      { nodeId: nodeInbox.id, nodeName: "Inbox" },
      { nodeId: nodeClients.id, nodeName: "Clients" },
    ],
    confidence: 0.82,
    explanation:
      "Vendor pricing update with no required action. Current plan is unaffected — informational only.",
    priority: Priority.LOW,
    urgency: Urgency.NONE,
    riskLevel: RiskLevel.LOW,
    requiredAction: RequiredAction.NONE,
    sensitivity: Sensitivity.NORMAL,
    suggestedNextStep: SuggestedNextStep.LABEL_ONLY,
    needsHumanReview: false,
  });

  // Ambiguous → routed through Inbox → Clients (low confidence)
  const classAmbiguous = await findOrCreateClassification({
    emailThreadId: threadAmbiguous.id,
    emailMessageId: msgAmbiguous.id,
    finalNodeId: nodeClients.id,
    path: [
      { nodeId: nodeInbox.id, nodeName: "Inbox" },
      { nodeId: nodeClients.id, nodeName: "Clients" },
    ],
    confidence: 0.38,
    explanation:
      "Vague subject and body. Unknown sender. No prior context. Cannot determine topic, urgency, or required action with confidence.",
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
    emailThreadId: threadUrgentClient.id,
    tagId: tags["VIP"]!,
    source: EmailTagSource.USER,
  });
  await findOrCreateEmailTag({
    emailThreadId: threadInvoice.id,
    tagId: tags["Accounting"]!,
    source: EmailTagSource.USER,
  });
  await findOrCreateEmailTag({
    emailThreadId: threadPersonal.id,
    tagId: tags["Personal"]!,
    source: EmailTagSource.USER,
  });
  await findOrCreateEmailTag({
    emailThreadId: threadVendorFYI.id,
    tagId: tags["Vendor"]!,
    source: EmailTagSource.AI_SUGGESTED,
  });

  // ── 12. ReviewItems ───────────────────────────────────────────────────────
  async function findOrCreateReviewItem(params: {
    emailThreadId: string;
    emailMessageId: string;
    classificationId: string;
    reason: string;
  }) {
    const existing = await db.reviewItem.findFirst({
      where: {
        emailThreadId: params.emailThreadId,
        classificationId: params.classificationId,
      },
    });
    if (existing) return existing;
    return db.reviewItem.create({
      data: {
        workspaceId,
        emailThreadId: params.emailThreadId,
        emailMessageId: params.emailMessageId,
        classificationId: params.classificationId,
        reason: params.reason,
        status: ReviewStatus.OPEN,
        assignedToUserId: user.id,
      },
    });
  }

  const reviewInvoice = await findOrCreateReviewItem({
    emailThreadId: threadInvoice.id,
    emailMessageId: msgInvoice.id,
    classificationId: classInvoice.id,
    reason:
      "High-value invoice ($8,400) requires explicit user approval before payment is processed.",
  });

  const reviewAmbiguous = await findOrCreateReviewItem({
    emailThreadId: threadAmbiguous.id,
    emailMessageId: msgAmbiguous.id,
    classificationId: classAmbiguous.id,
    reason:
      "Classification confidence is below threshold (0.38). Unknown sender and vague content.",
  });

  // ── 13. AuditLog entries ──────────────────────────────────────────────────
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
    entityId: classUrgentClient.id,
    metadata: {
      confidence: 0.94,
      finalNodeName: "Urgent",
      needsHumanReview: false,
    },
  });

  await findOrCreateAuditLog({
    actorType: AuditActorType.AI,
    eventType: "email.classified",
    entityType: "EmailClassification",
    entityId: classInvoice.id,
    metadata: {
      confidence: 0.97,
      finalNodeName: "Approval Needed",
      needsHumanReview: true,
    },
  });

  await findOrCreateAuditLog({
    actorType: AuditActorType.SYSTEM,
    eventType: "review.created",
    entityType: "ReviewItem",
    entityId: reviewInvoice.id,
    metadata: {
      reason: "High-value financial document",
      threadId: threadInvoice.id,
    },
  });

  await findOrCreateAuditLog({
    actorType: AuditActorType.AI,
    eventType: "email.classified",
    entityType: "EmailClassification",
    entityId: classAmbiguous.id,
    metadata: {
      confidence: 0.38,
      finalNodeName: "Clients",
      needsHumanReview: true,
    },
  });

  await findOrCreateAuditLog({
    actorType: AuditActorType.SYSTEM,
    eventType: "review.created",
    entityType: "ReviewItem",
    entityId: reviewAmbiguous.id,
    metadata: {
      reason: "Low confidence classification",
      threadId: threadAmbiguous.id,
    },
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
