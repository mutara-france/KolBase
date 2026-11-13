"use client";

import { useActionState } from "react";
import { Notice } from "@/components/AuthForms";
import { ActionForm } from "@/components/ActionForm";
import { useT } from "@/components/I18nProvider";
import { addCompetitor, addProduct, saveMarketNames } from "@/lib/intelligence-actions";
import { addWatchPin } from "@/lib/watch-actions";

/** Organisation à comparer : nom (proposé parmi les entreprises de la base publique), et autres écritures sous lesquelles elle déclare. */
export function CompetitorForm({ orgId, suggestions }: { orgId: string; suggestions: string[] }) {
  const t = useT();
  const [state, action, pending] = useActionState(addCompetitor, undefined);
  return (
    <ActionForm action={action} className="form stack-sm">
      <Notice state={state} />
      <input type="hidden" name="orgId" value={orgId} />
      <div className="row">
        <label>{t("Nom de l'organisation")}<input name="name" required maxLength={120} list="entreprises-base-publique" autoComplete="off" /></label>
        <label>{t("Autres écritures")}<input name="aliases" placeholder={t("Marques, filiales, séparées par des virgules")} />
          <span className="hint">{t("Une entreprise de la base publique lui est rattachée quand son nom contient l'une de ces écritures.")}</span>
        </label>
      </div>
      <datalist id="entreprises-base-publique">{suggestions.map((s) => <option key={s} value={s} />)}</datalist>
      <button className="btn small" disabled={pending}>{pending ? t("Enregistrement…") : t("Ajouter à ma comparaison")}</button>
    </ActionForm>
  );
}

/** Écritures sous lesquelles l'organisation déclare elle-même dans la base publique. */
export function MarketNamesForm({ orgId, names }: { orgId: string; names: string[] }) {
  const t = useT();
  const [state, action, pending] = useActionState(saveMarketNames, undefined);
  return (
    <ActionForm action={action} className="form stack-sm">
      <Notice state={state} />
      <input type="hidden" name="orgId" value={orgId} />
      <label>{t("Votre organisation dans la base publique")}<input name="names" defaultValue={names.join(", ")} maxLength={1500} list="entreprises-base-publique" autoComplete="off" />
        <span className="hint">{t("Raison sociale sous laquelle vous déclarez, et vos filiales, séparées par des virgules.")}</span>
      </label>
      <button className="btn small secondary" disabled={pending}>{pending ? t("Enregistrement…") : t("Enregistrer")}</button>
    </ActionForm>
  );
}

/** Publication ajoutée à la main à la veille de l'organisation (réseau social, article hors des sources relevées). */
export function WatchPinForm({ orgId }: { orgId: string }) {
  const t = useT();
  const [state, action, pending] = useActionState(addWatchPin, undefined);
  return (
    <ActionForm action={action} className="form stack-sm">
      <Notice state={state} />
      <input type="hidden" name="orgId" value={orgId} />
      <div className="row">
        <label>{t("Adresse de la publication")}<input name="url" type="url" required placeholder="https://…" /></label>
        <label className="short">{t("Date")}<input name="date" type="date" /></label>
      </div>
      <label>{t("Titre")}<input name="title" required maxLength={240} />
        <span className="hint">{t("Citez le concurrent concerné : la publication lui est rattachée par son nom.")}</span>
      </label>
      <label>{t("Note (facultatif)")}<input name="note" maxLength={300} /></label>
      <button className="btn small" disabled={pending}>{pending ? t("Enregistrement…") : t("Ajouter à la veille")}</button>
    </ActionForm>
  );
}

/** Produit ou gamme de l'organisation, auquel ses dossiers et ses événements se rattachent. */
export function ProductForm({ orgId }: { orgId: string }) {
  const t = useT();
  const [state, action, pending] = useActionState(addProduct, undefined);
  return (
    <ActionForm action={action} className="form stack-sm">
      <Notice state={state} />
      <input type="hidden" name="orgId" value={orgId} />
      <div className="row">
        <label>{t("Nom du produit")}<input name="name" required maxLength={120} /></label>
        <label>{t("Gamme ou marque (facultatif)")}<input name="range" maxLength={120} /></label>
      </div>
      <button className="btn small" disabled={pending}>{pending ? t("Enregistrement…") : t("Ajouter le produit")}</button>
    </ActionForm>
  );
}
