-- Photo d'un compte sans profil praticien (membres d'organisation).
ALTER TABLE "User" ADD COLUMN "photoUpdatedAt" TIMESTAMP(3);

CREATE TABLE "UserPhoto" (
    "userId" TEXT NOT NULL,
    "data" BYTEA NOT NULL,
    "thumb" BYTEA NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "UserPhoto_pkey" PRIMARY KEY ("userId")
);

ALTER TABLE "UserPhoto" ADD CONSTRAINT "UserPhoto_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
