-- CreateTable
CREATE TABLE "IdempotencyMarker" (
    "id" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "IdempotencyMarker_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "IdempotencyMarker_token_key" ON "IdempotencyMarker"("token");

-- CreateIndex
CREATE INDEX "IdempotencyMarker_createdAt_idx" ON "IdempotencyMarker"("createdAt");
