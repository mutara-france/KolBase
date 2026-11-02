"use client";

import { useActionState } from "react";
import { addPublication, addStructure, importOrcid, updateKolVisibility, updateOrgVisibility } from "@/lib/profile-actions";
import { Notice } from "@/components/AuthForms";
import { COMPANY_VIS_FIELDS, KOL_VIS_FIELDS, KOL_VISIBILITY_LEVELS, PROJECT_VISIBILITY_LEVELS, VISIBILITY_LEVELS, type CompanyVisibility, type KolVisibility } from "@/lib/visibility";
import { useLocale, useT } from "@/components/I18nProvider";

function VisRow({ name, label, desc, value, levels }: { name: string; label: string; desc: string; value: string; levels: { id: string; label: string; hint: string }[] }) {
  return (
    <div className="vis-row">
      <div><strong>{label}</strong><div className="text-xs">{desc}</div></div>
      <div className="vis-choices" role="radiogroup" aria-label={label}>
        {levels.map((l) => (
          <label key={l.id} className="vis-chip" title={l.hint}>
            <input type="radio" name={name} value={l.id} defaultChecked={value === l.id} />
            <span>{l.label}</span>
          </label>
        ))}
      </div>
    </div>
  );
}

export function KolVisibilityForm({ v }: { v: KolVisibility }) {
  const [state, action, pending] = useActionState(updateKolVisibility, undefined);
  const t = useT();
  const tr = (levels: { id: string; label: string; hint: string }[]) => levels.map((l) => ({ ...l, label: t(l.label), hint: t(l.hint) }));
  return (
    <form action={action} className="card form">
      <h2>{t("Visibilité de mon profil")}</h2>
      <p className="muted">{t("Choisissez, information par information, qui peut la voir sur votre fiche publique.")}</p>
      <Notice state={state} />
      {KOL_VIS_FIELDS.map((f) => <VisRow key={f.key} name={f.key} label={t(f.label)} desc={t(f.desc)} value={v[f.key]} levels={tr(KOL_VISIBILITY_LEVELS)} />)}
      <VisRow name="projets" label={t("Collaborations")} desc={t("Organisations et dossiers menés via KolBase.")} value={v.projets} levels={tr(PROJECT_VISIBILITY_LEVELS)} />
      <button className="btn" disabled={pending}>{pending ? t("Enregistrement…") : t("Enregistrer la visibilité")}</button>
    </form>
  );
}

export function OrgVisibilityForm({ orgId, v, listed }: { orgId: string; v: CompanyVisibility; listed: boolean }) {
  const [state, action, pending] = useActionState(updateOrgVisibility, undefined);
  return (
    <form action={action} className="card form">
      <h2>Page publique de l&apos;organisation</h2>
      <Notice state={state} />
      <input type="hidden" name="orgId" value={orgId} />
      <label className="check"><input type="checkbox" name="listed" value="1" defaultChecked={listed} /> Organisation référencée : visible sur le site public</label>
      {COMPANY_VIS_FIELDS.map((f) => <VisRow key={f.key} name={f.key} label={f.label} desc={f.desc} value={v[f.key]} levels={VISIBILITY_LEVELS} />)}
      <button className="btn" disabled={pending}>{pending ? "Enregistrement…" : "Enregistrer"}</button>
    </form>
  );
}

export function OrcidImportForm({ orcid, syncedAt, oauth, verified }: { orcid: string | null; syncedAt: string | null; oauth: boolean; verified: boolean }) {
  const [state, action, pending] = useActionState(importOrcid, undefined);
  const t = useT();
  // Connexion ORCID activée : l'iD est prouvé en se connectant à son compte, puis importé sans saisie.
  if (oauth && !verified)
    return (
      <div className="form orcid-form">
        <p className="muted">{t("Connectez votre compte ORCID pour importer vos publications : KolBase vérifie ainsi que l'iD est bien le vôtre.")}</p>
        <a className="btn secondary" href="/compte/orcid">{t("Connecter mon compte ORCID")}</a>
      </div>
    );
  return (
    <form action={action} className="form orcid-form">
      <Notice state={state} />
      <div className="row">
        {oauth ? (
          <p style={{ alignSelf: "end" }}>ORCID <strong className="mono">{orcid}</strong> <span className="pill ok">{t("vérifié")}</span></p>
        ) : (
          <label>{t("Identifiant ORCID")}<input name="orcid" defaultValue={orcid ?? ""} placeholder="0000-0000-0000-0000" /></label>
        )}
        <button className="btn secondary" disabled={pending} style={{ alignSelf: "end" }}>{pending ? t("Import…") : t("Importer depuis ORCID")}</button>
      </div>
      <p className="hint">{t("Récupère les travaux publics de votre profil ORCID, sans doublon.")}{syncedAt ? ` ${t("Dernier import : {date}.", { date: syncedAt })}` : ""}</p>
    </form>
  );
}

export function PublicationForm() {
  const [state, action, pending] = useActionState(addPublication, undefined);
  const t = useT();
  return (
    <form action={action} className="form" key={state?.ok ? Date.now() : "pub"}>
      <Notice state={state} />
      <label>{t("Titre")}<input name="title" required /></label>
      <div className="row">
        <label>{t("Revue")}<input name="journal" /></label>
        <label>{t("Année")}<input name="year" inputMode="numeric" /></label>
        <label>DOI<input name="doi" placeholder="10.xxxx/…" /></label>
      </div>
      <label>{t("Mots-clés")}<input name="keywords" placeholder={t("Séparés par des virgules")} /></label>
      <button className="btn secondary" disabled={pending}>{t("Ajouter la publication")}</button>
    </form>
  );
}

const LEGAL_FORMS = ["SELARL", "SELAS", "SASU", "SARL", "SCM", "SCP", "Société de conseil", "Association loi 1901", "Société savante", "Fondation", "Entreprise individuelle"];
const ROLES = ["Gérant", "Président", "Associé", "Membre du bureau", "Trésorier", "Administrateur", "Membre simple"];

export function StructureForm() {
  const [state, action, pending] = useActionState(addStructure, undefined);
  const t = useT();
  const locale = useLocale();
  return (
    <form action={action} className="form" key={state?.ok ? Date.now() : "struct"}>
      <Notice state={state} />
      <div className="row">
        {/* « Nom » désigne ailleurs le nom de famille (« Last name ») : ici, le nom de la structure. */}
        <label>{locale === "en" ? "Name" : "Nom"}<input name="name" required placeholder="SELARL Dr Dupont" /></label>
        <label>{t("Forme juridique")}<select name="legalForm" defaultValue="SELARL">{LEGAL_FORMS.map((f) => <option key={f} value={f}>{t(f)}</option>)}</select></label>
      </div>
      <div className="row">
        <label>SIREN<input name="siren" inputMode="numeric" /></label>
        <label>{t("Fonction")}<select name="role" defaultValue="Gérant">{ROLES.map((r) => <option key={r} value={r}>{t(r)}</option>)}</select></label>
        <label>{t("Parts (%)")}<input name="sharePercent" inputMode="numeric" /></label>
      </div>
      <label className="check"><input type="checkbox" name="isPayee" value="1" /> {t("Structure de facturation (reçoit les honoraires)")}</label>
      <button className="btn secondary" disabled={pending}>{t("Ajouter la structure")}</button>
    </form>
  );
}
