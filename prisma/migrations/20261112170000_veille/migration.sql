-- Veille de KolBase Intelligence : sources (flux RSS ou Atom) choisies par l'équipe KolBase, publications relevées,
-- et publications ajoutées à la main par une organisation.
CREATE TABLE "WatchSource" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "fetchedAt" TIMESTAMP(3),
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WatchSource_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "WatchItem" (
    "id" TEXT NOT NULL,
    "sourceId" TEXT,
    "organizationId" TEXT,
    "title" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "summary" TEXT,
    "publishedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WatchItem_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "WatchSource_url_key" ON "WatchSource"("url");
CREATE UNIQUE INDEX "WatchItem_sourceId_url_key" ON "WatchItem"("sourceId", "url");
CREATE INDEX "WatchItem_publishedAt_idx" ON "WatchItem"("publishedAt");
CREATE INDEX "WatchItem_organizationId_idx" ON "WatchItem"("organizationId");

ALTER TABLE "WatchItem" ADD CONSTRAINT "WatchItem_sourceId_fkey" FOREIGN KEY ("sourceId") REFERENCES "WatchSource"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "WatchItem" ADD CONSTRAINT "WatchItem_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
