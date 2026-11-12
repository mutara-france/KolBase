"use client";

import { useActionState, useState } from "react";
import { Notice } from "@/components/AuthForms";
import { ActionForm } from "@/components/ActionForm";
import { useT } from "@/components/I18nProvider";
import { requestBrandDomain, saveBrand } from "@/lib/brand-actions";
import { brandPalette, contrastWithWhite, MIN_CONTRAST } from "@/lib/brand";

/** Couleur de KolBase, proposée au départ dans le sélecteur. */
const DEFAULT_COLOR = "#1800ab";

/** Nom affiché et couleur principale, avec un aperçu de l'en-tête et d'un bouton à cette couleur. */
export function BrandForm({ orgId, orgName, displayName, color }: { orgId: string; orgName: string; displayName: string; color: string | null }) {
  const t = useT();
  const [state, action, pending] = useActionState(saveBrand, undefined);
  const [own, setOwn] = useState(!!color);
  const [value, setValue] = useState(color ?? DEFAULT_COLOR);
  const [name, setName] = useState(displayName);
  const palette = brandPalette(own ? value : DEFAULT_COLOR);
  const tooLight = own && contrastWithWhite(value) < MIN_CONTRAST;
  return (
    <ActionForm action={action} className="form stack-sm">
      <Notice state={state} />
      <input type="hidden" name="orgId" value={orgId} />
      <label>{t("Nom affiché")}<input name="displayName" value={name} onChange={(e) => setName(e.target.value)} maxLength={120} placeholder={orgName} />
        <span className="hint">{t("Vide : le nom de votre organisation.")}</span>
      </label>
      <label className="check"><input type="checkbox" name="useColor" value="1" checked={own} onChange={(e) => setOwn(e.target.checked)} /> <span>{t("Utiliser notre couleur à la place de celle de KolBase")}</span></label>
      {own && (
        <label className="short">{t("Couleur principale")}<input type="color" name="color" className="brand-color" value={value} onChange={(e) => setValue(e.target.value)} />
          {tooLight && <span className="hint warn-text" role="alert">{t("Trop claire : le texte blanc des boutons n'y serait pas lisible.")}</span>}
        </label>
      )}
      <div className="brand-preview" style={palette} aria-label={t("Aperçu")}>
        <span className="brand-preview-bar">{name || orgName}</span>
        <span className="btn small" aria-hidden>{t("Bouton")}</span>
        <span className="brand-preview-link" aria-hidden>{t("Lien")}</span>
      </div>
      <button className="btn small" disabled={pending || tooLight}>{pending ? t("Enregistrement…") : t("Enregistrer la marque")}</button>
    </ActionForm>
  );
}

/** Nom de domaine demandé par l'organisation (un seul à la fois). */
export function BrandDomainForm({ orgId }: { orgId: string }) {
  const t = useT();
  const [state, action, pending] = useActionState(requestBrandDomain, undefined);
  return (
    <ActionForm action={action} className="form stack-sm">
      <Notice state={state} />
      <input type="hidden" name="orgId" value={orgId} />
      <label>{t("Nom de domaine")}<input name="domain" required maxLength={253} placeholder="kol.votre-domaine.com" autoCapitalize="none" spellCheck={false} /></label>
      <button className="btn small secondary" disabled={pending}>{pending ? t("Enregistrement…") : t("Demander ce nom de domaine")}</button>
    </ActionForm>
  );
}
