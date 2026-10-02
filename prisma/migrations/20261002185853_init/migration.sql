-- CreateTable
CREATE TABLE "Prospect" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "ein" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "city" TEXT,
    "state" TEXT,
    "nteeCode" TEXT,
    "causeArea" TEXT,
    "website" TEXT,
    "status" TEXT NOT NULL DEFAULT 'New',
    "notes" TEXT NOT NULL DEFAULT '',
    "savedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "Organization" (
    "ein" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "city" TEXT,
    "state" TEXT,
    "nteeCode" TEXT,
    "fetchedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "FilingSnapshot" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "ein" TEXT NOT NULL,
    "taxYear" INTEGER NOT NULL,
    "totalRevenue" REAL,
    "totalExpenses" REAL,
    "totalAssets" REAL,
    "fetchedAt" DATETIME NOT NULL,
    CONSTRAINT "FilingSnapshot_ein_fkey" FOREIGN KEY ("ein") REFERENCES "Organization" ("ein") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "Prospect_ein_key" ON "Prospect"("ein");

-- CreateIndex
CREATE INDEX "Prospect_status_idx" ON "Prospect"("status");

-- CreateIndex
CREATE INDEX "Prospect_state_idx" ON "Prospect"("state");

-- CreateIndex
CREATE UNIQUE INDEX "FilingSnapshot_ein_taxYear_key" ON "FilingSnapshot"("ein", "taxYear");
