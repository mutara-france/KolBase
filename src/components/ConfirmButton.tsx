"use client";

import { useState, type ReactNode } from "react";
import { useFormStatus } from "react-dom";

/**
 * Geste irréversible en deux temps, sans boîte de dialogue du navigateur : le premier clic affiche le
 * récapitulatif et « Confirmer : … » (le vrai bouton d'envoi), avec « Revenir » pour renoncer.
 * À placer dans un <form action={…}> ; `name` et `value` partent avec la confirmation. Les champs
 * obligatoires du formulaire (motif…) sont contrôlés dès le premier clic.
 */
export function ConfirmButton({
  children,
  confirm,
  summary,
  className = "btn small",
  name,
  value,
  disabled,
  pending: busy,
}: {
  children: ReactNode;
  /** Suite de « Confirmer : » (« retenir ce devis », « suspendre l'organisation »…). */
  confirm: string;
  summary?: ReactNode;
  className?: string;
  name?: string;
  value?: string;
  disabled?: boolean;
  /** Envoi en cours, quand le formulaire n'est pas un simple <form action> (ActionForm, useActionState). */
  pending?: boolean;
}) {
  const [armed, setArmed] = useState(false);
  const status = useFormStatus();
  const pending = busy ?? status.pending;
  if (!armed)
    return (
      <button
        type="button"
        className={className}
        disabled={disabled}
        onClick={(e) => {
          const form = e.currentTarget.form;
          if (form && !form.reportValidity()) return;
          setArmed(true);
        }}
      >
        {children}
      </button>
    );
  return (
    <span className="confirm-step" role="group" aria-label="Confirmation">
      {summary && <span className="confirm-summary">{summary}</span>}
      <button type="submit" className="btn small danger" name={name} value={value} disabled={pending} autoFocus>
        {pending ? "Un instant…" : `Confirmer : ${confirm}`}
      </button>
      <button type="button" className="link" onClick={() => setArmed(false)} disabled={pending}>
        Revenir
      </button>
    </span>
  );
}
