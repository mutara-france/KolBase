"use client";

import { useActionState } from "react";
import { updateComplianceSettings } from "@/lib/compliance-actions";
import { Notice } from "@/components/AuthForms";
import type { ComplianceSettings } from "@/lib/compliance";

type Field = { key: keyof ComplianceSettings; label: string; unit: string; group: string; legal?: { min?: number; max?: number } | null };

export function ComplianceSettingsForm({ orgId, settings, fields, canEdit }: { orgId: string; settings: ComplianceSettings; fields: Field[]; canEdit: boolean }) {
  const [state, action, pending] = useActionState(updateComplianceSettings, undefined);
  const groups = [...new Set(fields.map((f) => f.group))];
  return (
    <form action={action} className="card form">
      <h2>Paramètres de conformité</h2>
      <p className="muted">
        Valeurs par défaut reprises des arrêtés du 7 août 2020 (seuils au-delà desquels une autorisation est requise).
        Votre organisation peut les rendre plus strictes (seuils plus bas, délais plus longs), jamais plus souples.
      </p>
      <Notice state={state} />
      <input type="hidden" name="orgId" value={orgId} />
      {groups.map((g) => (
        <fieldset key={g} className="stack">
          <legend><strong>{g}</strong></legend>
          {fields.filter((f) => f.group === g).map((f) => (
            <label key={f.key}>
              {f.label} <span className="muted">({f.unit})</span>
              <input
                name={f.key} type="number" step="any" defaultValue={settings[f.key]} required disabled={!canEdit}
                min={f.legal?.min ?? 0} max={f.legal?.max}
              />
              {f.legal && <span className="hint">{f.legal.max != null ? `Plafond réglementaire : ${f.legal.max} ${f.unit}.` : `Minimum réglementaire : ${f.legal.min} ${f.unit}.`}</span>}
            </label>
          ))}
        </fieldset>
      ))}
      {canEdit && <button className="btn" disabled={pending}>{pending ? "Enregistrement…" : "Enregistrer"}</button>}
    </form>
  );
}
