-- AlterTable
ALTER TABLE "Project" ADD COLUMN     "budgetCents" INTEGER;

-- CreateTable
CREATE TABLE "Material" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Material_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MaterialVersion" (
    "id" TEXT NOT NULL,
    "materialId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "url" TEXT,
    "notes" TEXT,
    "status" TEXT NOT NULL DEFAULT 'submitted',
    "submittedById" TEXT NOT NULL,
    "reviewerId" TEXT,
    "reviewComment" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MaterialVersion_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "MaterialVersion_materialId_version_key" ON "MaterialVersion"("materialId", "version");

-- AddForeignKey
ALTER TABLE "Material" ADD CONSTRAINT "Material_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MaterialVersion" ADD CONSTRAINT "MaterialVersion_materialId_fkey" FOREIGN KEY ("materialId") REFERENCES "Material"("id") ON DELETE CASCADE ON UPDATE CASCADE;
