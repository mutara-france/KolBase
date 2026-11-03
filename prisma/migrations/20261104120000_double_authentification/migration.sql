-- Double authentification (TOTP) : secret, codes de secours, exigence par organisation, étape de connexion.
ALTER TYPE "AuthTokenPurpose" ADD VALUE 'TWO_FACTOR';
ALTER TABLE "User" ADD COLUMN "totpSecret" TEXT, ADD COLUMN "totpEnabledAt" TIMESTAMP(3), ADD COLUMN "totpLastStep" INTEGER, ADD COLUMN "recoveryCodes" TEXT[] DEFAULT ARRAY[]::TEXT[];
ALTER TABLE "Organization" ADD COLUMN "require2fa" BOOLEAN NOT NULL DEFAULT false;
