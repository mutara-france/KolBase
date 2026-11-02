"use client";

import { useRef, useState, useTransition } from "react";
import { Sparkles } from "lucide-react";
import { aiDraft } from "@/lib/ai-actions";

/**
 * Bouton « Proposer avec l'IA » placé dans un formulaire : il envoie les champs utiles du formulaire,
 * puis remplit le champ cible avec le brouillon proposé (à relire avant d'enregistrer).
 */
export function AiDraft({ kind, target, label = "Proposer avec l'IA", extra }: { kind: string; target: string; label?: string; extra?: Record<string, string> }) {
  const ref = useRef<HTMLDivElement>(null);
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<{ ok?: string; error?: string } | null>(null);
  const run = () => {
    const form = ref.current?.closest("form");
    if (!form) return;
    const fd = new FormData(form);
    fd.delete("file");
    fd.delete("logo");
    fd.set("aiKind", kind);
    for (const [k, v] of Object.entries(extra ?? {})) fd.set(k, v);
    setMsg(null);
    start(async () => {
      const r = await aiDraft(fd);
      if (r.error || !r.text) return setMsg({ error: r.error ?? "Pas de proposition." });
      const field = form.elements.namedItem(target) as HTMLTextAreaElement | HTMLInputElement | null;
      if (field) {
        field.value = r.text;
        field.dispatchEvent(new Event("input", { bubbles: true }));
        field.focus();
      }
      setMsg({ ok: "Brouillon proposé par l'assistant : relisez-le et adaptez-le avant d'enregistrer." });
    });
  };
  return (
    <div ref={ref} className="ai-draft">
      <button type="button" className="btn ghost small ai-btn" onClick={run} disabled={pending}>
        <Sparkles size={14} /> {pending ? "Rédaction en cours…" : label}
      </button>
      {msg && <span className={`text-xs ${msg.error ? "error-text" : "muted"}`} role="status">{msg.error ?? msg.ok}</span>}
    </div>
  );
}
