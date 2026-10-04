-- CreateTable
CREATE TABLE "Publication" (
    "id" TEXT NOT NULL,
    "practitionerId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "journal" TEXT,
    "year" INTEGER,
    "doi" TEXT,
    "keywords" TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Publication_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Publication_practitionerId_idx" ON "Publication"("practitionerId");

-- AddForeignKey
ALTER TABLE "Publication" ADD CONSTRAINT "Publication_practitionerId_fkey" FOREIGN KEY ("practitionerId") REFERENCES "PractitionerProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;
