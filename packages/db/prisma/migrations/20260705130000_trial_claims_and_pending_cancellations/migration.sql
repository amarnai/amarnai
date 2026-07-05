-- Reset-immune record that an email identity (and optionally a card) has consumed
-- the single free trial. No FK to User/Workspace so account deletion cannot erase
-- it. emailKeyHash = sha256(normalizeInboxKey(email)); the raw email is never stored.
-- CreateTable
CREATE TABLE "TrialClaim" (
    "id" TEXT NOT NULL,
    "emailKeyHash" TEXT NOT NULL,
    "cardFingerprint" TEXT,
    "stripeSubscriptionId" TEXT,
    "userId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TrialClaim_pkey" PRIMARY KEY ("id")
);

-- Durable no-FK retry record guaranteeing a deleted account's Stripe subscription
-- is canceled even if Stripe was unreachable at deletion time.
-- CreateTable
CREATE TABLE "PendingSubscriptionCancellation" (
    "id" TEXT NOT NULL,
    "stripeSubscriptionId" TEXT NOT NULL,
    "userId" TEXT,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "lastError" TEXT,
    "lastAttemptAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PendingSubscriptionCancellation_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "TrialClaim_emailKeyHash_key" ON "TrialClaim"("emailKeyHash");

-- CreateIndex
CREATE UNIQUE INDEX "TrialClaim_cardFingerprint_key" ON "TrialClaim"("cardFingerprint");

-- CreateIndex
CREATE UNIQUE INDEX "PendingSubscriptionCancellation_stripeSubscriptionId_key" ON "PendingSubscriptionCancellation"("stripeSubscriptionId");
