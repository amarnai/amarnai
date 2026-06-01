-- CreateEnum
CREATE TYPE "BillingCycle" AS ENUM ('MONTHLY', 'ANNUAL');

-- AlterTable
ALTER TABLE "Workspace"
  ADD COLUMN "stripeCustomerId"     TEXT,
  ADD COLUMN "stripeSubscriptionId" TEXT,
  ADD COLUMN "stripePriceId"        TEXT,
  ADD COLUMN "billingCycle"         "BillingCycle",
  ADD COLUMN "trialEndsAt"          TIMESTAMP(3),
  ADD COLUMN "currentPeriodEnd"     TIMESTAMP(3),
  ADD COLUMN "cancelAtPeriodEnd"    BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "paymentFailed"        BOOLEAN NOT NULL DEFAULT false;

-- CreateIndex
CREATE UNIQUE INDEX "Workspace_stripeSubscriptionId_key" ON "Workspace"("stripeSubscriptionId");
