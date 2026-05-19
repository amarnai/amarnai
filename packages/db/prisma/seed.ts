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

  // Root
  const nodeInbox = await findOrCreateNode({
    name: "Inbox",
    description: "Top-level entry point for all incoming email",
    isRoot: true,
    isVisibleCategory: false,
    canReceiveEmails: false,
    positionX: 0,
    positionY: 0,
  });

  // ── Tenoua magazine branch ────────────────────────────────────────────────

  // Hidden intermediate: routes all Tenoua magazine email before sub-categorising.
  const nodeTenouaRouting = await findOrCreateNode({
    name: "Tenoua routing",
    description:
      "Hidden sorting step that routes Tenoua magazine email to the correct sub-category: editorial, subscriptions, contributors, or partnerships.",
    isVisibleCategory: false,
    canReceiveEmails: false,
    positionX: -400,
    positionY: -200,
  });

  const nodeEditorial = await findOrCreateNode({
    name: "Editorial / pitches",
    description:
      "Article proposals, editorial submissions, content pitches, and writing queries addressed to the Tenoua editorial team.",
    isVisibleCategory: true,
    canReceiveEmails: true,
    positionX: -800,
    positionY: -400,
  });

  const nodeSubscriptions = await findOrCreateNode({
    name: "Subscriptions / distribution",
    description:
      "Reader subscription requests, renewals, delivery issues, and distribution logistics for Tenoua magazine.",
    isVisibleCategory: true,
    canReceiveEmails: true,
    positionX: -550,
    positionY: -400,
  });

  const nodeContributors = await findOrCreateNode({
    name: "Contributors",
    description:
      "Correspondence with current or prospective Tenoua contributors, authors, illustrators, and translators.",
    isVisibleCategory: true,
    canReceiveEmails: true,
    positionX: -300,
    positionY: -400,
  });

  const nodePartnerships = await findOrCreateNode({
    name: "Partnerships / press",
    description:
      "Institutional partnership offers, press inquiries, advertising proposals, and media relations for Tenoua magazine.",
    isVisibleCategory: true,
    canReceiveEmails: true,
    positionX: -50,
    positionY: -400,
  });

  // ── Delphine Horvilleur secretariat branch ────────────────────────────────

  // Hidden intermediate: first triage gate for all secretariat requests.
  const nodeSecretariatTriage = await findOrCreateNode({
    name: "Secretariat request triage",
    description:
      "Hidden sorting step that routes secretariat requests for Delphine Horvilleur to the correct sub-category: ceremonies, bookings, media, or general admin.",
    isVisibleCategory: false,
    canReceiveEmails: false,
    positionX: 400,
    positionY: -200,
  });

  // Hidden intermediate: distinguishes weddings from funerals/memorials.
  const nodeCeremonyTriage = await findOrCreateNode({
    name: "Lifecycle ceremony triage",
    description:
      "Hidden sorting step for lifecycle ceremony requests — distinguishes wedding ceremony requests from funeral or memorial service requests.",
    isVisibleCategory: false,
    canReceiveEmails: false,
    positionX: 200,
    positionY: -400,
  });

  const nodeWeddings = await findOrCreateNode({
    name: "Weddings",
    description:
      "Wedding ceremony requests, officiation inquiries, and marriage-related correspondence addressed to Delphine Horvilleur.",
    isVisibleCategory: true,
    canReceiveEmails: true,
    positionX: 100,
    positionY: -600,
  });

  const nodeFunerals = await findOrCreateNode({
    name: "Funerals",
    description:
      "Funeral service requests, memorial ceremony inquiries, and mourning-related correspondence addressed to Delphine Horvilleur.",
    isVisibleCategory: true,
    canReceiveEmails: true,
    positionX: 300,
    positionY: -600,
  });

  // Hidden intermediate: separates conference/speaking bookings from media requests.
  const nodeBookingQualification = await findOrCreateNode({
    name: "Booking qualification",
    description:
      "Hidden sorting step for external engagements — routes speaking invitations and conference bookings away from media and press interview requests.",
    isVisibleCategory: false,
    canReceiveEmails: false,
    positionX: 600,
    positionY: -400,
  });

  const nodeConferences = await findOrCreateNode({
    name: "Conferences / invitations",
    description:
      "Speaking engagement invitations, conference participation requests, panel invitations, and event booking requests for Delphine Horvilleur.",
    isVisibleCategory: true,
    canReceiveEmails: true,
    positionX: 500,
    positionY: -600,
  });

  const nodeMediaInterviews = await findOrCreateNode({
    name: "Media / interviews",
    description:
      "Journalist interview requests, radio and TV appearance inquiries, podcast invitations, and press profile requests for Delphine Horvilleur.",
    isVisibleCategory: true,
    canReceiveEmails: true,
    positionX: 700,
    positionY: -600,
  });

  const nodeGeneralSecretariat = await findOrCreateNode({
    name: "General secretariat",
    description:
      "General administrative correspondence for Delphine Horvilleur that does not fit a more specific secretariat category.",
    isVisibleCategory: true,
    canReceiveEmails: true,
    positionX: 850,
    positionY: -400,
  });

  // ── Catch-all ─────────────────────────────────────────────────────────────

  const nodeOtherReview = await findOrCreateNode({
    name: "Other / needs review",
    description:
      "Email that does not clearly fit the Tenoua magazine branch or the Delphine Horvilleur secretariat branch and requires human review.",
    isVisibleCategory: true,
    canReceiveEmails: true,
    positionX: 0,
    positionY: 200,
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

  // Inbox → top-level routing
  await findOrCreateEdge({
    sourceNodeId: nodeInbox.id,
    targetNodeId: nodeTenouaRouting.id,
    sortingQuestion:
      "Is this email related to Tenoua magazine — editorial content, subscriptions, contributors, or partnerships?",
    priority: 0,
  });

  await findOrCreateEdge({
    sourceNodeId: nodeInbox.id,
    targetNodeId: nodeSecretariatTriage.id,
    sortingQuestion:
      "Is this email for Delphine Horvilleur's secretariat — a ceremony, speaking engagement, media request, or administrative matter?",
    priority: 1,
  });

  await findOrCreateEdge({
    sourceNodeId: nodeInbox.id,
    targetNodeId: nodeOtherReview.id,
    sortingQuestion:
      "Does this email not clearly fit Tenoua magazine or the secretariat?",
    priority: 2,
  });

  // Tenoua routing → Tenoua sub-categories
  await findOrCreateEdge({
    sourceNodeId: nodeTenouaRouting.id,
    targetNodeId: nodeEditorial.id,
    sortingQuestion:
      "Is this an article pitch, editorial submission, or content proposal for Tenoua?",
    priority: 0,
  });

  await findOrCreateEdge({
    sourceNodeId: nodeTenouaRouting.id,
    targetNodeId: nodeSubscriptions.id,
    sortingQuestion:
      "Is this about a reader subscription, renewal, or delivery issue for Tenoua?",
    priority: 1,
  });

  await findOrCreateEdge({
    sourceNodeId: nodeTenouaRouting.id,
    targetNodeId: nodeContributors.id,
    sortingQuestion:
      "Is this from or about a Tenoua contributor, author, illustrator, or translator?",
    priority: 2,
  });

  await findOrCreateEdge({
    sourceNodeId: nodeTenouaRouting.id,
    targetNodeId: nodePartnerships.id,
    sortingQuestion:
      "Is this a partnership offer, press inquiry, or institutional relations matter for Tenoua?",
    priority: 3,
  });

  // Secretariat request triage → secretariat sub-categories
  await findOrCreateEdge({
    sourceNodeId: nodeSecretariatTriage.id,
    targetNodeId: nodeCeremonyTriage.id,
    sortingQuestion:
      "Is this a lifecycle ceremony request — a wedding or a funeral/memorial?",
    priority: 0,
  });

  await findOrCreateEdge({
    sourceNodeId: nodeSecretariatTriage.id,
    targetNodeId: nodeBookingQualification.id,
    sortingQuestion:
      "Is this a speaking engagement, conference invitation, or media/press request?",
    priority: 1,
  });

  // Weak fallback — relies on node description for context.
  await findOrCreateEdge({
    sourceNodeId: nodeSecretariatTriage.id,
    targetNodeId: nodeGeneralSecretariat.id,
    sortingQuestion: "yes",
    priority: 2,
  });

  // Lifecycle ceremony triage → ceremony leaves
  // Weak yes/no edges; node descriptions carry the wedding vs. funeral distinction.
  await findOrCreateEdge({
    sourceNodeId: nodeCeremonyTriage.id,
    targetNodeId: nodeWeddings.id,
    sortingQuestion: "yes",
    priority: 0,
  });

  await findOrCreateEdge({
    sourceNodeId: nodeCeremonyTriage.id,
    targetNodeId: nodeFunerals.id,
    sortingQuestion: "no",
    priority: 1,
  });

  // Booking qualification → engagement leaves
  // Weak yes/no edges; node descriptions carry the conference vs. media distinction.
  await findOrCreateEdge({
    sourceNodeId: nodeBookingQualification.id,
    targetNodeId: nodeConferences.id,
    sortingQuestion: "yes",
    priority: 0,
  });

  await findOrCreateEdge({
    sourceNodeId: nodeBookingQualification.id,
    targetNodeId: nodeMediaInterviews.id,
    sortingQuestion: "no",
    priority: 1,
  });

  // ── 8. Tags ───────────────────────────────────────────────────────────────
  const tagDefs = [
    { name: "Cérémonie", color: "#8B5CF6" },
    { name: "Tenoua", color: "#F59E0B" },
    { name: "Médias", color: "#3B82F6" },
    { name: "Secrétariat", color: "#10B981" },
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

  // 1. Wedding ceremony request → Weddings
  const { thread: threadWedding, message: msgWedding } =
    await findOrCreateThread({
      providerThreadId: "thread-001",
      providerMessageId: "msg-001",
      subject: "Cérémonie de mariage — demande d'officiant pour le 14 septembre",
      senderEmail: "marion.levy@gmail.com",
      senderName: "Marion Lévy",
      snippet:
        "Nous souhaitons vous contacter au sujet de notre mariage prévu le 14 septembre. Seriez-vous disponible pour célébrer notre union ?",
      bodyText: [
        "Madame Horvilleur,",
        "",
        "Mon fiancé et moi souhaitons vous demander si vous seriez disponible pour officier notre cérémonie de mariage le 14 septembre prochain à Paris.",
        "",
        "Nous sommes très attachés à une cérémonie qui reflète nos valeurs et notre parcours familial. Nous aurions aimé vous rencontrer pour en discuter.",
        "",
        "Dans l'attente de votre réponse,",
        "Marion Lévy",
      ].join("\n"),
      receivedAt: new Date("2026-05-17T10:30:00Z"),
      toEmails: ["demo@genizor.local"],
    });

  // 2. Funeral / memorial request → Funerals
  const { thread: threadFuneral, message: msgFuneral } =
    await findOrCreateThread({
      providerThreadId: "thread-002",
      providerMessageId: "msg-002",
      subject: "Cérémonie funèbre — notre père nous a quittés",
      senderEmail: "david.cohen@outlook.com",
      senderName: "David Cohen",
      snippet:
        "Notre père est décédé lundi. Nous cherchons quelqu'un pour présider la cérémonie funèbre en accord avec notre tradition.",
      bodyText: [
        "Madame,",
        "",
        "Notre père, Abraham Cohen, nous a quittés lundi dernier. Nous sommes une famille pratiquante et souhaitons organiser une cérémonie funèbre qui honore sa mémoire.",
        "",
        "Quelqu'un nous a recommandé votre nom. Seriez-vous disponible pour nous accompagner dans ce moment douloureux ?",
        "",
        "Avec respect,",
        "David Cohen",
      ].join("\n"),
      receivedAt: new Date("2026-05-16T08:00:00Z"),
      toEmails: ["demo@genizor.local"],
    });

  // 3. Tenoua article pitch → Editorial / pitches
  const { thread: threadPitch, message: msgPitch } =
    await findOrCreateThread({
      providerThreadId: "thread-003",
      providerMessageId: "msg-003",
      subject: "Proposition d'article : Les nouvelles liturgies du quotidien",
      senderEmail: "sarah.benguigui@journaliste.fr",
      senderName: "Sarah Benguigui",
      snippet:
        "Je me permets de vous soumettre une proposition d'article sur les rituels profanes qui structurent nos vies modernes.",
      bodyText: [
        "Chère équipe de Tenoua,",
        "",
        "Je suis journaliste et essayiste, et je me permets de vous soumettre une proposition d'article intitulée 'Les nouvelles liturgies du quotidien'.",
        "",
        "Ce texte explore comment des rituels profanes — repas en famille, moments de silence, gestes hebdomadaires — remplissent une fonction proche du sacré dans nos vies modernes. Je pense que cela correspond à la ligne éditoriale de Tenoua.",
        "",
        "Je serais ravie d'en discuter avec vous.",
        "Sarah Benguigui",
      ].join("\n"),
      receivedAt: new Date("2026-05-15T14:20:00Z"),
      toEmails: ["demo@genizor.local"],
    });

  // 4. Subscription delivery issue → Subscriptions / distribution
  const { thread: threadSubscription, message: msgSubscription } =
    await findOrCreateThread({
      providerThreadId: "thread-004",
      providerMessageId: "msg-004",
      subject: "[Tenoua] Abonnement #2024-876 — numéro printemps non reçu",
      senderEmail: "pierre.simon@free.fr",
      senderName: "Pierre Simon",
      snippet:
        "Abonné depuis deux ans, je n'ai pas reçu le numéro de printemps. Pouvez-vous vérifier ma livraison ?",
      bodyText: [
        "Bonjour,",
        "",
        "Je suis abonné à Tenoua depuis deux ans (abonnement n°2024-876). Je n'ai toujours pas reçu le numéro de printemps alors que nous sommes mi-mai.",
        "",
        "Pouvez-vous vérifier si mon numéro a bien été expédié et me donner un suivi de livraison ?",
        "",
        "Merci,",
        "Pierre Simon",
      ].join("\n"),
      receivedAt: new Date("2026-05-14T09:45:00Z"),
      toEmails: ["demo@genizor.local"],
    });

  // 5. Radio interview request → Media / interviews
  const { thread: threadInterview, message: msgInterview } =
    await findOrCreateThread({
      providerThreadId: "thread-005",
      providerMessageId: "msg-005",
      subject: "Invitation : émission 'Voix du monde' — France Inter, juin 2026",
      senderEmail: "productrice@franceinter.example",
      senderName: "Amélie Rousseau — France Inter",
      snippet:
        "Nous aimerions vous inviter dans notre émission 'Voix du monde' pour parler de votre dernier ouvrage. Enregistrement prévu début juin.",
      bodyText: [
        "Madame Horvilleur,",
        "",
        "Je suis productrice de l'émission 'Voix du monde' sur France Inter. Nous aimerions vous recevoir pour un entretien consacré à votre dernier ouvrage et à votre engagement pour le dialogue interreligieux.",
        "",
        "L'enregistrement serait prévu début juin, pour une diffusion le 14 juin.",
        "",
        "Seriez-vous disponible ? Merci de bien vouloir confirmer.",
        "",
        "Amélie Rousseau",
      ].join("\n"),
      receivedAt: new Date("2026-05-17T16:00:00Z"),
      toEmails: ["demo@genizor.local"],
    });

  // 6. Vague admin request → Other / needs review (low confidence)
  const { thread: threadVague, message: msgVague } =
    await findOrCreateThread({
      providerThreadId: "thread-006",
      providerMessageId: "msg-006",
      subject: "Suite à notre échange",
      senderEmail: "contact@domaineinconnu.example",
      senderName: "M. Marchand",
      snippet:
        "Comme convenu, je reviens vers vous. Merci de me dire comment procéder.",
      bodyText: [
        "Bonjour,",
        "",
        "Comme convenu lors de notre échange, je reviens vers vous. Merci de me faire savoir comment procéder pour la suite.",
        "",
        "Cordialement,",
        "M. Marchand",
      ].join("\n"),
      receivedAt: new Date("2026-05-17T07:30:00Z"),
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

  // Wedding → Inbox → Secretariat request triage → Lifecycle ceremony triage → Weddings
  const classWedding = await findOrCreateClassification({
    emailThreadId: threadWedding.id,
    emailMessageId: msgWedding.id,
    finalNodeId: nodeWeddings.id,
    path: [
      { nodeId: nodeInbox.id, nodeName: "Inbox" },
      { nodeId: nodeSecretariatTriage.id, nodeName: "Secretariat request triage" },
      { nodeId: nodeCeremonyTriage.id, nodeName: "Lifecycle ceremony triage" },
      { nodeId: nodeWeddings.id, nodeName: "Weddings" },
    ],
    confidence: 0.93,
    explanation:
      "Explicit request to officiate a wedding ceremony on a named date. Sender is a private individual seeking a ceremony officiant.",
    priority: Priority.MEDIUM,
    urgency: Urgency.SOON,
    riskLevel: RiskLevel.LOW,
    requiredAction: RequiredAction.REPLY,
    sensitivity: Sensitivity.PERSONAL_DATA,
    suggestedNextStep: SuggestedNextStep.OPEN_IN_GMAIL,
    needsHumanReview: false,
  });

  // Funeral → Inbox → Secretariat request triage → Lifecycle ceremony triage → Funerals
  const classFuneral = await findOrCreateClassification({
    emailThreadId: threadFuneral.id,
    emailMessageId: msgFuneral.id,
    finalNodeId: nodeFunerals.id,
    path: [
      { nodeId: nodeInbox.id, nodeName: "Inbox" },
      { nodeId: nodeSecretariatTriage.id, nodeName: "Secretariat request triage" },
      { nodeId: nodeCeremonyTriage.id, nodeName: "Lifecycle ceremony triage" },
      { nodeId: nodeFunerals.id, nodeName: "Funerals" },
    ],
    confidence: 0.95,
    explanation:
      "Recent bereavement. Family requests a funeral ceremony presided by Delphine Horvilleur. Urgent pastoral care context.",
    priority: Priority.HIGH,
    urgency: Urgency.TODAY,
    riskLevel: RiskLevel.LOW,
    requiredAction: RequiredAction.REPLY,
    sensitivity: Sensitivity.PERSONAL_DATA,
    suggestedNextStep: SuggestedNextStep.OPEN_IN_GMAIL,
    needsHumanReview: false,
  });

  // Article pitch → Inbox → Tenoua routing → Editorial / pitches
  const classPitch = await findOrCreateClassification({
    emailThreadId: threadPitch.id,
    emailMessageId: msgPitch.id,
    finalNodeId: nodeEditorial.id,
    path: [
      { nodeId: nodeInbox.id, nodeName: "Inbox" },
      { nodeId: nodeTenouaRouting.id, nodeName: "Tenoua routing" },
      { nodeId: nodeEditorial.id, nodeName: "Editorial / pitches" },
    ],
    confidence: 0.91,
    explanation:
      "Professional journalist submitting a named article proposal for Tenoua. Subject and body both explicitly reference editorial content.",
    priority: Priority.MEDIUM,
    urgency: Urgency.NONE,
    riskLevel: RiskLevel.LOW,
    requiredAction: RequiredAction.REPLY,
    sensitivity: Sensitivity.NORMAL,
    suggestedNextStep: SuggestedNextStep.LABEL_ONLY,
    needsHumanReview: false,
  });

  // Subscription issue → Inbox → Tenoua routing → Subscriptions / distribution
  const classSubscription = await findOrCreateClassification({
    emailThreadId: threadSubscription.id,
    emailMessageId: msgSubscription.id,
    finalNodeId: nodeSubscriptions.id,
    path: [
      { nodeId: nodeInbox.id, nodeName: "Inbox" },
      { nodeId: nodeTenouaRouting.id, nodeName: "Tenoua routing" },
      { nodeId: nodeSubscriptions.id, nodeName: "Subscriptions / distribution" },
    ],
    confidence: 0.88,
    explanation:
      "Reader reports a missing issue by subscription number. Clear distribution problem for Tenoua magazine.",
    priority: Priority.LOW,
    urgency: Urgency.SOON,
    riskLevel: RiskLevel.LOW,
    requiredAction: RequiredAction.REPLY,
    sensitivity: Sensitivity.NORMAL,
    suggestedNextStep: SuggestedNextStep.LABEL_ONLY,
    needsHumanReview: false,
  });

  // Interview request → Inbox → Secretariat request triage → Booking qualification → Media / interviews
  const classInterview = await findOrCreateClassification({
    emailThreadId: threadInterview.id,
    emailMessageId: msgInterview.id,
    finalNodeId: nodeMediaInterviews.id,
    path: [
      { nodeId: nodeInbox.id, nodeName: "Inbox" },
      { nodeId: nodeSecretariatTriage.id, nodeName: "Secretariat request triage" },
      { nodeId: nodeBookingQualification.id, nodeName: "Booking qualification" },
      { nodeId: nodeMediaInterviews.id, nodeName: "Media / interviews" },
    ],
    confidence: 0.89,
    explanation:
      "France Inter producer inviting Delphine Horvilleur for a radio interview. Named programme, named airdate — clear media request.",
    priority: Priority.MEDIUM,
    urgency: Urgency.SOON,
    riskLevel: RiskLevel.LOW,
    requiredAction: RequiredAction.REPLY,
    sensitivity: Sensitivity.NORMAL,
    suggestedNextStep: SuggestedNextStep.LABEL_ONLY,
    needsHumanReview: false,
  });

  // Vague admin → Inbox → Other / needs review (low confidence)
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
      "Vague subject and body. Unknown sender. No context about Tenoua, ceremonies, or specific secretariat topics. Cannot classify with confidence.",
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
    emailThreadId: threadWedding.id,
    tagId: tags["Cérémonie"]!,
    source: EmailTagSource.AI_SUGGESTED,
  });
  await findOrCreateEmailTag({
    emailThreadId: threadFuneral.id,
    tagId: tags["Cérémonie"]!,
    source: EmailTagSource.AI_SUGGESTED,
  });
  await findOrCreateEmailTag({
    emailThreadId: threadPitch.id,
    tagId: tags["Tenoua"]!,
    source: EmailTagSource.AI_SUGGESTED,
  });
  await findOrCreateEmailTag({
    emailThreadId: threadSubscription.id,
    tagId: tags["Tenoua"]!,
    source: EmailTagSource.USER,
  });
  await findOrCreateEmailTag({
    emailThreadId: threadInterview.id,
    tagId: tags["Médias"]!,
    source: EmailTagSource.AI_SUGGESTED,
  });
  await findOrCreateEmailTag({
    emailThreadId: threadVague.id,
    tagId: tags["Secrétariat"]!,
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

  const reviewVague = await findOrCreateReviewItem({
    emailThreadId: threadVague.id,
    emailMessageId: msgVague.id,
    classificationId: classVague.id,
    reason:
      "Classification confidence is below threshold (0.29). Unknown sender, vague subject, and no secretariat or Tenoua context.",
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
    entityId: classWedding.id,
    metadata: { confidence: 0.93, finalNodeName: "Weddings", needsHumanReview: false },
  });

  await findOrCreateAuditLog({
    actorType: AuditActorType.AI,
    eventType: "email.classified",
    entityType: "EmailClassification",
    entityId: classFuneral.id,
    metadata: { confidence: 0.95, finalNodeName: "Funerals", needsHumanReview: false },
  });

  await findOrCreateAuditLog({
    actorType: AuditActorType.AI,
    eventType: "email.classified",
    entityType: "EmailClassification",
    entityId: classPitch.id,
    metadata: { confidence: 0.91, finalNodeName: "Editorial / pitches", needsHumanReview: false },
  });

  await findOrCreateAuditLog({
    actorType: AuditActorType.AI,
    eventType: "email.classified",
    entityType: "EmailClassification",
    entityId: classSubscription.id,
    metadata: { confidence: 0.88, finalNodeName: "Subscriptions / distribution", needsHumanReview: false },
  });

  await findOrCreateAuditLog({
    actorType: AuditActorType.AI,
    eventType: "email.classified",
    entityType: "EmailClassification",
    entityId: classInterview.id,
    metadata: { confidence: 0.89, finalNodeName: "Media / interviews", needsHumanReview: false },
  });

  await findOrCreateAuditLog({
    actorType: AuditActorType.AI,
    eventType: "email.classified",
    entityType: "EmailClassification",
    entityId: classVague.id,
    metadata: { confidence: 0.29, finalNodeName: "Other / needs review", needsHumanReview: true },
  });

  await findOrCreateAuditLog({
    actorType: AuditActorType.SYSTEM,
    eventType: "review.created",
    entityType: "ReviewItem",
    entityId: reviewVague.id,
    metadata: { reason: "Low confidence classification", threadId: threadVague.id },
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
