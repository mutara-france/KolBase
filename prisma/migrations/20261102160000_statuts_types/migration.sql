-- Statuts stockés en texte convertis en types énumérés (mêmes valeurs).
-- Par sécurité, une valeur inattendue est ramenée à la valeur par défaut au lieu de bloquer la migration.

-- CreateEnum
CREATE TYPE "ApplicationStatus" AS ENUM ('pending', 'retained', 'rejected', 'declined');

-- CreateEnum
CREATE TYPE "OpenCallStatus" AS ENUM ('open', 'closed');

-- CreateEnum
CREATE TYPE "RfqStatus" AS ENUM ('draft', 'sent', 'awarded', 'cancelled');

-- CreateEnum
CREATE TYPE "QuoteStatus" AS ENUM ('submitted', 'retained', 'rejected');

-- CreateEnum
CREATE TYPE "ReviewStatus" AS ENUM ('submitted', 'approved', 'changes');

-- CreateEnum
CREATE TYPE "ExpenseStatus" AS ENUM ('draft', 'engagee', 'payee');

-- CreateEnum
CREATE TYPE "RegistrationKind" AS ENUM ('participant', 'speaker');

-- AlterTable
ALTER TABLE "Application" ALTER COLUMN "status" DROP DEFAULT,
ALTER COLUMN "status" SET DATA TYPE "ApplicationStatus" USING (CASE WHEN "status" IN ('pending', 'retained', 'rejected', 'declined') THEN "status" ELSE 'pending' END)::"ApplicationStatus",
ALTER COLUMN "status" SET DEFAULT 'pending';

-- AlterTable
ALTER TABLE "SpeakerApplication" ALTER COLUMN "status" DROP DEFAULT,
ALTER COLUMN "status" SET DATA TYPE "ApplicationStatus" USING (CASE WHEN "status" IN ('pending', 'retained', 'rejected', 'declined') THEN "status" ELSE 'pending' END)::"ApplicationStatus",
ALTER COLUMN "status" SET DEFAULT 'pending';

-- AlterTable
ALTER TABLE "OpenCall" ALTER COLUMN "status" DROP DEFAULT,
ALTER COLUMN "status" SET DATA TYPE "OpenCallStatus" USING (CASE WHEN "status" IN ('open', 'closed') THEN "status" ELSE 'open' END)::"OpenCallStatus",
ALTER COLUMN "status" SET DEFAULT 'open';

-- AlterTable
ALTER TABLE "Rfq" ALTER COLUMN "status" DROP DEFAULT,
ALTER COLUMN "status" SET DATA TYPE "RfqStatus" USING (CASE WHEN "status" IN ('draft', 'sent', 'awarded', 'cancelled') THEN "status" ELSE 'draft' END)::"RfqStatus",
ALTER COLUMN "status" SET DEFAULT 'draft';

-- AlterTable
ALTER TABLE "Quote" ALTER COLUMN "status" DROP DEFAULT,
ALTER COLUMN "status" SET DATA TYPE "QuoteStatus" USING (CASE WHEN "status" IN ('submitted', 'retained', 'rejected') THEN "status" ELSE 'submitted' END)::"QuoteStatus",
ALTER COLUMN "status" SET DEFAULT 'submitted';

-- AlterTable
ALTER TABLE "MaterialVersion" ALTER COLUMN "status" DROP DEFAULT,
ALTER COLUMN "status" SET DATA TYPE "ReviewStatus" USING (CASE WHEN "status" IN ('submitted', 'approved', 'changes') THEN "status" ELSE 'submitted' END)::"ReviewStatus",
ALTER COLUMN "status" SET DEFAULT 'submitted';

-- AlterTable
ALTER TABLE "Expense" ALTER COLUMN "status" DROP DEFAULT,
ALTER COLUMN "status" SET DATA TYPE "ExpenseStatus" USING (CASE WHEN "status" IN ('draft', 'engagee', 'payee') THEN "status" ELSE 'draft' END)::"ExpenseStatus",
ALTER COLUMN "status" SET DEFAULT 'draft';

-- AlterTable
ALTER TABLE "Registration" ALTER COLUMN "kind" DROP DEFAULT,
ALTER COLUMN "kind" SET DATA TYPE "RegistrationKind" USING (CASE WHEN "kind" IN ('participant', 'speaker') THEN "kind" ELSE 'participant' END)::"RegistrationKind",
ALTER COLUMN "kind" SET DEFAULT 'participant';
