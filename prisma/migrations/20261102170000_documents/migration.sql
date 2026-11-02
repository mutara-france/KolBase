-- CreateEnum
CREATE TYPE "DocumentKind" AS ENUM ('CONVENTION_SIGNEE', 'PIECE');

-- Aucune fonctionnalité n'écrivait encore dans cette table : une ligne sans fichier n'a pas de sens.
DELETE FROM "Document" WHERE "storageKey" IS NULL;

-- AlterTable
ALTER TABLE "Document" DROP COLUMN "approved",
DROP COLUMN "type",
DROP COLUMN "version",
ADD COLUMN     "contentType" TEXT NOT NULL DEFAULT 'application/octet-stream',
ADD COLUMN     "kind" "DocumentKind" NOT NULL DEFAULT 'PIECE',
ADD COLUMN     "projectExpertId" TEXT,
ADD COLUMN     "size" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "uploadedById" TEXT,
ALTER COLUMN "storageKey" SET NOT NULL;

ALTER TABLE "Document" ALTER COLUMN "contentType" DROP DEFAULT,
ALTER COLUMN "size" DROP DEFAULT;

-- CreateIndex
CREATE UNIQUE INDEX "Document_storageKey_key" ON "Document"("storageKey");

-- CreateIndex
CREATE INDEX "Document_projectId_idx" ON "Document"("projectId");

-- AddForeignKey
ALTER TABLE "Document" ADD CONSTRAINT "Document_projectExpertId_fkey" FOREIGN KEY ("projectExpertId") REFERENCES "ProjectExpert"("id") ON DELETE CASCADE ON UPDATE CASCADE;
