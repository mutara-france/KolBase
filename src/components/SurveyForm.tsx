"use client";

import { useActionState, useState } from "react";
import { Star } from "lucide-react";
import { submitSurvey } from "@/lib/followup-actions";
import { useT } from "@/components/I18nProvider";

function Stars({ name, label, required = false }: { name: string; label: string; required?: boolean }) {
  const t = useT();
  const [value, setValue] = useState(0);
  return (
    <fieldset className="survey-q">
      <legend>{label}{required ? " *" : ""}</legend>
      <div className="stars" role="radiogroup" aria-label={label}>
        {[1, 2, 3, 4, 5].map((n) => (
          <label key={n} className={n <= value ? "on" : ""} title={`${n}/5`}>
            <input type="radio" name={name} value={n} required={required} onChange={() => setValue(n)} aria-label={t("{n} sur 5", { n })} />
            <Star size={26} />
          </label>
        ))}
      </div>
    </fieldset>
  );
}

/** Questionnaire de satisfaction : note globale (obligatoire), contenu, organisation, commentaire. */
export function SurveyForm({ eventId }: { eventId: string }) {
  const t = useT();
  const [state, action, pending] = useActionState(submitSurvey, undefined);
  if (state?.ok) return <p className="notice ok">{state.ok}</p>;
  return (
    <form action={action} className="card form survey-form">
      {state?.error && <p className="notice error">{state.error}</p>}
      <input type="hidden" name="eventId" value={eventId} />
      <Stars name="overall" label={t("Dans l'ensemble, êtes-vous satisfait ?")} required />
      <Stars name="content" label={t("Contenu scientifique")} />
      <Stars name="logistics" label={t("Organisation et accueil")} />
      <label>{t("Un commentaire pour l'organisateur (facultatif)")}
        <textarea name="comment" rows={4} maxLength={2000} placeholder={t("Ce qui vous a plu, ce qui pourrait être amélioré…")} />
      </label>
      <button className="btn" disabled={pending}>{pending ? t("Envoi…") : t("Envoyer mon avis")}</button>
    </form>
  );
}
