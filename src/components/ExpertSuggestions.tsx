"use client";

import { useRef, useState, useTransition } from "react";
import { AlertTriangle, Check, Plus, Sparkles } from "lucide-react";
import { suggestExpertsAction, type SuggestResult } from "@/lib/ai-actions";

type Picked = { id: string; name: string; detail: string; dayRateCents: number | null };

/**
 * « Suggérer des experts » : classement explicable (spécialité, publications, diversité, liens d'intérêts),
 * résumé par l'assistant quand il est activé. Lit les champs du formulaire de dossier.
 */
export function ExpertSuggestions({ orgId, selected, onAdd }: { orgId: string; selected: string[]; onAdd: (e: Picked) => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const [pending, start] = useTransition();
  const [res, setRes] = useState<SuggestResult | null>(null);
  const run = () => {
    const form = ref.current?.closest("form");
    if (!form) return;
    const fd = new FormData(form);
    fd.set("orgId", orgId);
    start(async () => setRes(await suggestExpertsAction(fd)));
  };
  return (
    <div ref={ref} className="suggest stack-sm">
      <button type="button" className="btn ghost small ai-btn" onClick={run} disabled={pending}>
        <Sparkles size={14} /> {pending ? "Recherche des profils…" : "Suggérer des experts"}
      </button>
      {res?.error && <p className="text-xs error-text" role="alert">{res.error}</p>}
      {res?.suggestions && (
        <div className="suggest-box" role="status">
          {res.suggestions.length === 0 ? (
            <p className="muted text-sm">Aucun profil ne correspond clairement : précisez le domaine ou l&apos;objet.</p>
          ) : (
            <>
              {res.summary && <p className="suggest-summary"><Sparkles size={13} /> {res.summary}</p>}
              <ul className="suggest-list">
                {res.suggestions.map((s) => {
                  const added = selected.includes(s.id);
                  return (
                    <li key={s.id}>
                      <div>
                        <strong>{s.name}</strong> <span className="muted text-sm">{s.detail}</span>
                        <div className="text-xs">{s.reasons.join(" · ")}</div>
                        {s.notes.map((n) => <div key={n} className="text-xs muted">{n}</div>)}
                        {s.warnings.map((w) => <div key={w} className="text-xs warn-text"><AlertTriangle size={11} /> {w}</div>)}
                      </div>
                      <button type="button" className={`btn small ${added ? "ghost" : "secondary"}`} disabled={added} onClick={() => onAdd(s)}>
                        {added ? <><Check size={13} /> Ajouté</> : <><Plus size={13} /> Ajouter</>}
                      </button>
                    </li>
                  );
                })}
              </ul>
              <p className="hint">Classement indicatif : pertinence du profil, diversité des experts sollicités par votre organisation et liens d&apos;intérêts connus. Le choix vous appartient.</p>
            </>
          )}
        </div>
      )}
    </div>
  );
}
