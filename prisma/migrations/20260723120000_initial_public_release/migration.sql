-- CreateTable
CREATE TABLE "AutomatedOrder" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "ownerAddress" TEXT NOT NULL,
    "executionWallet" TEXT NOT NULL,
    "chainId" INTEGER NOT NULL,
    "dexAdapterId" TEXT NOT NULL,
    "tokenIn" TEXT NOT NULL,
    "tokenOut" TEXT NOT NULL,
    "amountIn" TEXT NOT NULL,
    "triggerPrice" TEXT,
    "triggerDirection" TEXT,
    "orderType" TEXT NOT NULL,
    "orderSubtype" TEXT,
    "maximumSlippageBps" INTEGER NOT NULL,
    "maximumPriceImpactBps" INTEGER NOT NULL,
    "deadlineSeconds" INTEGER NOT NULL,
    "maximumGasPriceGwei" TEXT,
    "expiresAt" DATETIME,
    "status" TEXT NOT NULL,
    "transactionHash" TEXT,
    "failureReason" TEXT,
    "retryCount" INTEGER NOT NULL DEFAULT 0,
    "triggeredAt" DATETIME,
    "executedAt" DATETIME,
    "metadata" JSONB,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "OrderExecution" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "orderId" TEXT NOT NULL,
    "attempt" INTEGER NOT NULL,
    "quoteBlockNumber" TEXT,
    "expectedOutput" TEXT NOT NULL,
    "minimumOutput" TEXT NOT NULL,
    "transactionHash" TEXT,
    "nonce" TEXT,
    "gasEstimate" TEXT,
    "gasUsed" TEXT,
    "effectiveGasPrice" TEXT,
    "status" TEXT NOT NULL,
    "errorCode" TEXT,
    "errorMessage" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "OrderExecution_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "AutomatedOrder" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "OrderEvent" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "orderId" TEXT NOT NULL,
    "eventType" TEXT NOT NULL,
    "message" TEXT,
    "metadata" JSONB,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "OrderEvent_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "AutomatedOrder" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "TrackedTransaction" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "walletAddress" TEXT NOT NULL,
    "chainId" INTEGER NOT NULL,
    "transactionHash" TEXT NOT NULL,
    "transactionType" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "blockNumber" TEXT,
    "gasUsed" TEXT,
    "metadata" JSONB,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "Watchlist" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "ownerAddress" TEXT NOT NULL,
    "tokenAddress" TEXT NOT NULL,
    "chainId" INTEGER NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "TokenMetadata" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "address" TEXT NOT NULL,
    "chainId" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "symbol" TEXT NOT NULL,
    "decimals" INTEGER NOT NULL,
    "creator" TEXT,
    "isRobinFun" BOOLEAN NOT NULL DEFAULT false,
    "dexLive" BOOLEAN NOT NULL DEFAULT false,
    "pairAddress" TEXT,
    "exchangeRate" TEXT,
    "holdersCount" INTEGER,
    "totalSupply" TEXT,
    "factoryAddress" TEXT,
    "lastUpdated" DATETIME NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "UsedAuthorization" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "digest" TEXT NOT NULL,
    "ownerAddress" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "expiresAt" DATETIME NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateIndex
CREATE INDEX "AutomatedOrder_ownerAddress_chainId_idx" ON "AutomatedOrder"("ownerAddress", "chainId");
CREATE INDEX "AutomatedOrder_chainId_status_idx" ON "AutomatedOrder"("chainId", "status");
CREATE INDEX "OrderExecution_orderId_idx" ON "OrderExecution"("orderId");
CREATE INDEX "OrderEvent_orderId_idx" ON "OrderEvent"("orderId");
CREATE UNIQUE INDEX "TrackedTransaction_transactionHash_key" ON "TrackedTransaction"("transactionHash");
CREATE UNIQUE INDEX "Watchlist_ownerAddress_tokenAddress_chainId_key" ON "Watchlist"("ownerAddress", "tokenAddress", "chainId");
CREATE UNIQUE INDEX "TokenMetadata_address_key" ON "TokenMetadata"("address");
CREATE INDEX "TokenMetadata_chainId_isRobinFun_idx" ON "TokenMetadata"("chainId", "isRobinFun");
CREATE INDEX "TokenMetadata_factoryAddress_idx" ON "TokenMetadata"("factoryAddress");
CREATE UNIQUE INDEX "UsedAuthorization_digest_key" ON "UsedAuthorization"("digest");
CREATE INDEX "UsedAuthorization_expiresAt_idx" ON "UsedAuthorization"("expiresAt");
