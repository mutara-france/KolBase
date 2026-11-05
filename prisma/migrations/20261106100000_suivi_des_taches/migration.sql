-- Suivi des tâches planifiées : dernière exécution et dernière réussite.
CREATE TABLE "TaskRun" (
    "name" TEXT NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL,
    "okAt" TIMESTAMP(3),
    "error" TEXT,
    "result" JSONB,

    CONSTRAINT "TaskRun_pkey" PRIMARY KEY ("name")
);
