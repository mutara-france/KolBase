"use client";

import { useState, useTransition } from "react";
import { Copy, Sparkles } from "lucide-react";
import { aiReviewProject } from "@/lib/ai-actions";
import { useT } from "@/components/I18nProvider";

/** Relecture assistée d'un dossier (équipe conformité) : points à vérifier, avis proposé, message au chef de projet. */
export function AiReview({ orgId, projectId }: { orgId: string; projectId: string }) {
  const t = useT();
  const [pending, start] = useTransition();
  const [res, setRes] = useState<{ text?: string; error?: string } | null>(null);
  const [copied, setCopied] = useState(false);
  const run = () => {
    const fd = new FormData();
    fd.set("orgId", orgId);
    fd.set("projectId", projectId);
    setCopied(false);
    start(async () => setRes(await aiReviewProject(fd)));
  };
  return (
    <div className="stack-sm">
      <button type="button" className="btn ghost small ai-btn" onClick={run} disabled={pending}>
        <Sparkles size={14} /> {pending ? t("Analyse en cours…") : res?.text ? t("Relancer l'analyse") : t("Analyser le dossier avec l'IA")}
      </button>
      {res?.error && <p className="text-xs error-text" role="alert">{res.error}</p>}
      {res?.text && (
        <div className="ai-review" role="status">
          <pre>{res.text}</pre>
          <button
            type="button"
            className="link"
            onClick={async () => {
              await navigator.clipboard?.writeText(res.text!).catch(() => {});
              setCopied(true);
            }}
          >
            <Copy size={12} /> {copied ? t("Copié") : t("Copier")}
          </button>
        </div>
      )}
      <p className="hint">{t("Aide à la relecture : l'analyse s'appuie sur les contrôles de KolBase et le contenu du dossier ; la décision reste la vôtre.")}</p>
    </div>
  );
}
