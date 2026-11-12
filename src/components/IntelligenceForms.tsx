"use client";

import { useActionState } from "react";
import { Notice } from "@/components/AuthForms";
import { ActionForm } from "@/components/ActionForm";
import { useT } from "@/components/I18nProvider";
import { addCompetitor, importPublicFile } from "@/lib/intelligence-actions";

/** Concurrent à suivre : nom, et autres écritures sous lesquelles il déclare (marques, filiales). */
export function CompetitorForm({ orgId }: { orgId: string }) {
  const t = useT();
  const [state, action, pending] = useActionState(addCompetitor, undefined);
  return (
    <ActionForm action={action} className="form stack-sm">
      <Notice state={state} />
      <input type="hidden" name="orgId" value={orgId} />
      <div className="row">
        <label>{t("Nom du concurrent")}<input name="name" required maxLength={120} /></label>
        <label>{t("Autres écritures")}<input name="aliases" placeholder={t("Marques, filiales, séparées par des virgules")} />
          <span className="hint">{t("Une déclaration est rattachée au concurrent quand le nom de l'entreprise déclarante contient l'une de ces écritures.")}</span>
        </label>
      </div>
      <button className="btn small" disabled={pending}>{pending ? t("Enregistrement…") : t("Suivre ce concurrent")}</button>
    </ActionForm>
  );
}

/** Dépôt d'un export de la base publique Transparence Santé, avec l'attestation d'origine et de licence. */
export function PublicImportForm({ orgId }: { orgId: string }) {
  const t = useT();
  const [state, action, pending] = useActionState(importPublicFile, undefined);
  return (
    <ActionForm action={action} className="form stack-sm">
      <Notice state={state} />
      <input type="hidden" name="orgId" value={orgId} />
      <label>{t("Fichier exporté (CSV ou Excel .xlsx, 10 Mo au plus)")}<input type="file" name="file" required accept=".csv,.xlsx,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" /></label>
      <label className="check"><input type="checkbox" name="licence" value="1" required /> <span>{t("J'ai téléchargé ce fichier sur le site public Transparence Santé et notre organisation l'utilise dans le respect de sa licence de réutilisation (finalité de transparence des liens d'intérêts).")}</span></label>
      <button className="btn small" disabled={pending}>{pending ? t("Import en cours…") : t("Importer le fichier")}</button>
    </ActionForm>
  );
}
