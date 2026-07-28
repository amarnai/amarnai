-- CreateTable
CREATE TABLE "AuthBridgeCode" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "codeHash" TEXT NOT NULL,
    "usedAt" TIMESTAMP(3),
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuthBridgeCode_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "AuthBridgeCode_codeHash_key" ON "AuthBridgeCode"("codeHash");

-- CreateIndex
CREATE INDEX "AuthBridgeCode_userId_idx" ON "AuthBridgeCode"("userId");

-- AddForeignKey
ALTER TABLE "AuthBridgeCode" ADD CONSTRAINT "AuthBridgeCode_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
