"use client";

import { useActionState } from "react";
import { addPublication, addStructure, importOrcid, updateKolVisibility, updateOrgVisibility } from "@/lib/profile-actions";
import { Notice } from "@/components/AuthForms";
import { COMPANY_VIS_FIELDS, KOL_VIS_FIELDS, PROJECT_VISIBILITY_LEVELS, VISIBILITY_LEVELS, type CompanyVisibility, type KolVisibility } from "@/lib/visibility";

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
  return (
    <form action={action} className="card form">
      <h2>Visibilité de mon profil</h2>
      <p className="muted">Choisissez, information par information, qui peut la voir sur votre fiche publique.</p>
      <Notice state={state} />
      {KOL_VIS_FIELDS.map((f) => <VisRow key={f.key} name={f.key} label={f.label} desc={f.desc} value={v[f.key]} levels={VISIBILITY_LEVELS} />)}
      <VisRow name="projets" label="Collaborations" desc="Organisations et dossiers menés via Kolbase." value={v.projets} levels={PROJECT_VISIBILITY_LEVELS} />
      <button className="btn" disabled={pending}>{pending ? "Enregistrement…" : "Enregistrer la visibilité"}</button>
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

export function OrcidImportForm({ orcid, syncedAt }: { orcid: string | null; syncedAt: string | null }) {
  const [state, action, pending] = useActionState(importOrcid, undefined);
  return (
    <form action={action} className="form orcid-form">
      <Notice state={state} />
      <div className="row">
        <label>Identifiant ORCID<input name="orcid" defaultValue={orcid ?? ""} placeholder="0000-0000-0000-0000" /></label>
        <button className="btn secondary" disabled={pending} style={{ alignSelf: "end" }}>{pending ? "Import…" : "Importer depuis ORCID"}</button>
      </div>
      <p className="hint">Récupère les travaux publics de votre profil ORCID, sans doublon.{syncedAt ? ` Dernier import : ${syncedAt}.` : ""}</p>
    </form>
  );
}

export function PublicationForm() {
  const [state, action, pending] = useActionState(addPublication, undefined);
  return (
    <form action={action} className="form" key={state?.ok ? Date.now() : "pub"}>
      <Notice state={state} />
      <label>Titre<input name="title" required /></label>
      <div className="row">
        <label>Revue<input name="journal" /></label>
        <label>Année<input name="year" inputMode="numeric" /></label>
        <label>DOI<input name="doi" placeholder="10.xxxx/…" /></label>
      </div>
      <label>Mots-clés<input name="keywords" placeholder="Séparés par des virgules" /></label>
      <button className="btn secondary" disabled={pending}>Ajouter la publication</button>
    </form>
  );
}

const LEGAL_FORMS = ["SELARL", "SELAS", "SASU", "SARL", "SCM", "SCP", "Société de conseil", "Association loi 1901", "Société savante", "Fondation", "Entreprise individuelle"];
const ROLES = ["Gérant", "Président", "Associé", "Membre du bureau", "Trésorier", "Administrateur", "Membre simple"];

export function StructureForm() {
  const [state, action, pending] = useActionState(addStructure, undefined);
  return (
    <form action={action} className="form" key={state?.ok ? Date.now() : "struct"}>
      <Notice state={state} />
      <div className="row">
        <label>Nom<input name="name" required placeholder="SELARL Dr Dupont" /></label>
        <label>Forme juridique<select name="legalForm" defaultValue="SELARL">{LEGAL_FORMS.map((f) => <option key={f}>{f}</option>)}</select></label>
      </div>
      <div className="row">
        <label>SIREN<input name="siren" inputMode="numeric" /></label>
        <label>Fonction<select name="role" defaultValue="Gérant">{ROLES.map((r) => <option key={r}>{r}</option>)}</select></label>
        <label>Parts (%)<input name="sharePercent" inputMode="numeric" /></label>
      </div>
      <label className="check"><input type="checkbox" name="isPayee" value="1" /> Structure de facturation (reçoit les honoraires)</label>
      <button className="btn secondary" disabled={pending}>Ajouter la structure</button>
    </form>
  );
}
