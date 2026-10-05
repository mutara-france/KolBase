-- AlterTable
ALTER TABLE "Event" ADD COLUMN     "agencyId" TEXT;

-- AddForeignKey
ALTER TABLE "Event" ADD CONSTRAINT "Event_agencyId_fkey" FOREIGN KEY ("agencyId") REFERENCES "Organization"("id") ON DELETE SET NULL ON UPDATE CASCADE;
