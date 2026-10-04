-- AlterTable
ALTER TABLE "Organization" ADD COLUMN     "complianceSettings" JSONB NOT NULL DEFAULT '{}';

-- AlterTable
ALTER TABLE "Project" ADD COLUMN     "declarationRef" TEXT,
ADD COLUMN     "declaredAt" TIMESTAMP(3);
