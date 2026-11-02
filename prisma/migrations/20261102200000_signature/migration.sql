-- Signature électronique des conventions (Yousign).

-- CreateEnum
CREATE TYPE "SignatureStatus" AS ENUM ('draft', 'ongoing', 'done', 'declined', 'expired', 'canceled');

-- CreateTable
CREATE TABLE "ConventionSignature" (
    "id" TEXT NOT NULL,
    "projectExpertId" TEXT NOT NULL,
    "requestId" TEXT NOT NULL,
    "documentId" TEXT,
    "status" "SignatureStatus" NOT NULL DEFAULT 'draft',
    "sentById" TEXT,
    "sentAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "note" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ConventionSignature_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ConventionSignature_projectExpertId_key" ON "ConventionSignature"("projectExpertId");

-- CreateIndex
CREATE UNIQUE INDEX "ConventionSignature_requestId_key" ON "ConventionSignature"("requestId");

-- AddForeignKey
ALTER TABLE "ConventionSignature" ADD CONSTRAINT "ConventionSignature_projectExpertId_fkey" FOREIGN KEY ("projectExpertId") REFERENCES "ProjectExpert"("id") ON DELETE CASCADE ON UPDATE CASCADE;
