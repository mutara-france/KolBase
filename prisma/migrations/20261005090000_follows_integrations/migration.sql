-- AlterTable
ALTER TABLE "User" ADD COLUMN     "followsSeenAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "PractitionerProfile" ADD COLUMN     "orcidSyncedAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "Publication" ADD COLUMN     "source" TEXT;

-- CreateTable
CREATE TABLE "Follow" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "practitionerId" TEXT,
    "organizationId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Follow_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Follow_userId_practitionerId_key" ON "Follow"("userId", "practitionerId");

-- CreateIndex
CREATE UNIQUE INDEX "Follow_userId_organizationId_key" ON "Follow"("userId", "organizationId");

-- AddForeignKey
ALTER TABLE "Follow" ADD CONSTRAINT "Follow_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Follow" ADD CONSTRAINT "Follow_practitionerId_fkey" FOREIGN KEY ("practitionerId") REFERENCES "PractitionerProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Follow" ADD CONSTRAINT "Follow_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
