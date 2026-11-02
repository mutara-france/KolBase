-- CreateEnum
CREATE TYPE "OrgVerification" AS ENUM ('PENDING', 'VERIFIED', 'REJECTED');

-- AlterTable
ALTER TABLE "Organization" ADD COLUMN     "legalName" TEXT,
ADD COLUMN     "siren" TEXT,
ADD COLUMN     "sirenActive" BOOLEAN,
ADD COLUMN     "sirenCheckedAt" TIMESTAMP(3),
ADD COLUMN     "verification" "OrgVerification" NOT NULL DEFAULT 'PENDING',
ADD COLUMN     "verificationNote" TEXT,
ADD COLUMN     "verifiedAt" TIMESTAMP(3),
ADD COLUMN     "verifiedById" TEXT;

-- AlterTable
ALTER TABLE "PractitionerProfile" ADD COLUMN     "orcidVerified" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "rppsCheckNote" TEXT,
ADD COLUMN     "rppsCheckedAt" TIMESTAMP(3);

-- Reprise de l'existant : les organisations déjà inscrites restent actives (à revoir dans l'administration KolBase).
UPDATE "Organization" SET "verification" = 'VERIFIED', "verifiedAt" = CURRENT_TIMESTAMP;

-- Seuls les praticiens diplômés peuvent rester référencés comme experts.
UPDATE "PractitionerProfile" SET "listed" = false, "listedAt" = NULL
WHERE "listed" AND "profession" NOT IN ('Chirurgien-dentiste', 'Chirurgien-dentiste spécialiste ODF', 'Chirurgien oral', 'Médecin stomatologue');
