"use client";

import { useActionState, useState } from "react";
import { createInvitation, createOrganization, updateOrganization, updateExpertProfile, type InviteState } from "@/lib/org-actions";
import { Notice } from "@/components/AuthForms";

type Opt = { value: string; label: string };

export function NewOrgForm({ kinds }: { kinds: Opt[] }) {
  const [state, action, pending] = useActionState(createOrganization, undefined);
  return (
    <form action={action} className="card form">
      <h1>Créer une organisation</h1>
      <p className="muted">Vous en serez l&apos;administrateur et pourrez ensuite inviter vos collègues.</p>
      <Notice state={state} />
      <label>Nom de l&apos;organisation<input name="name" required /></label>
      <label>Type
        <select name="kind" defaultValue="INDUSTRIEL">{kinds.map((k) => <option key={k.value} value={k.value}>{k.label}</option>)}</select>
      </label>
      <div className="row">
        <label>Secteur<input name="sector" placeholder="Dispositifs médicaux…" /></label>
        <label>Siège<input name="headquarters" placeholder="Lyon, France" /></label>
      </div>
      <label>E-mail de contact<input name="contactEmail" type="email" /></label>
      <button className="btn" disabled={pending}>{pending ? "Création…" : "Créer l'organisation"}</button>
    </form>
  );
}

type Org = { id: string; name: string; sector: string | null; headquarters: string | null; contactEmail: string | null; about: string | null; policy: string | null; areas: string[] };

export function EditOrgForm({ org }: { org: Org }) {
  const [state, action, pending] = useActionState(updateOrganization, undefined);
  return (
    <form action={action} className="card form">
      <h2>Fiche de l&apos;organisation</h2>
      <Notice state={state} />
      <input type="hidden" name="orgId" value={org.id} />
      <label>Nom<input name="name" defaultValue={org.name} required /></label>
      <div className="row">
        <label>Secteur<input name="sector" defaultValue={org.sector ?? ""} /></label>
        <label>Siège<input name="headquarters" defaultValue={org.headquarters ?? ""} /></label>
      </div>
      <label>E-mail de contact<input name="contactEmail" type="email" defaultValue={org.contactEmail ?? ""} /></label>
      <label>Domaines thérapeutiques<input name="areas" defaultValue={org.areas.join(", ")} placeholder="Implantologie, Parodontologie…" />
        <span className="hint">Séparés par des virgules.</span>
      </label>
      <label>Présentation<textarea name="about" rows={3} defaultValue={org.about ?? ""} /></label>
      <label>Politique de collaboration<textarea name="policy" rows={3} defaultValue={org.policy ?? ""} /></label>
      <button className="btn" disabled={pending}>{pending ? "Enregistrement…" : "Enregistrer"}</button>
    </form>
  );
}

export function InviteForm({ orgId, roles }: { orgId: string; roles: Opt[] }) {
  const [state, action, pending] = useActionState<InviteState, FormData>(createInvitation, undefined);
  const [copied, setCopied] = useState(false);
  return (
    <form action={action} className="card form">
      <h2>Inviter un membre</h2>
      <p className="muted">Kolbase génère un lien d&apos;invitation à transmettre vous-même à la personne.</p>
      <Notice state={state} />
      {state?.link && (
        <div className="copy">
          <input readOnly value={state.link} onFocus={(e) => e.currentTarget.select()} />
          <button type="button" className="btn ghost" onClick={() => { navigator.clipboard.writeText(state.link!); setCopied(true); }}>
            {copied ? "Copié" : "Copier"}
          </button>
        </div>
      )}
      <input type="hidden" name="orgId" value={orgId} />
      <div className="row">
        <label>Rôle
          <select name="role" defaultValue="EDUCATION">{roles.map((r) => <option key={r.value} value={r.value}>{r.label}</option>)}</select>
        </label>
        <label>E-mail (mémo, facultatif)<input name="email" type="email" /></label>
      </div>
      <button className="btn" disabled={pending} onClick={() => setCopied(false)}>{pending ? "Génération…" : "Générer le lien"}</button>
    </form>
  );
}

type Expert = { bio: string | null; hospital: string | null; subspecialty: string | null; orcid: string | null; languages: string[]; interventionTypes: string[]; dayRateCents: number | null };

export function ExpertProfileForm({ p, types }: { p: Expert; types: string[] }) {
  const [state, action, pending] = useActionState(updateExpertProfile, undefined);
  return (
    <form action={action} className="card form">
      <h2>Profil expert</h2>
      <p className="muted">Ces informations apparaissent dans l&apos;annuaire, consulté par les organisations.</p>
      <Notice state={state} />
      <label>Présentation<textarea name="bio" rows={4} defaultValue={p.bio ?? ""} placeholder="Parcours, domaines d'expertise, publications marquantes…" /></label>
      <div className="row">
        <label>Établissement / cabinet<input name="hospital" defaultValue={p.hospital ?? ""} /></label>
        <label>Sur-spécialité<input name="subspecialty" defaultValue={p.subspecialty ?? ""} /></label>
      </div>
      <div className="row">
        <label>Langues<input name="languages" defaultValue={p.languages.join(", ")} placeholder="fr, en" /></label>
        <label>ORCID<input name="orcid" defaultValue={p.orcid ?? ""} placeholder="0000-0000-0000-0000" /></label>
      </div>
      <fieldset>
        <legend>Types d&apos;intervention</legend>
        <div className="checks">
          {types.map((t) => (
            <label key={t} className="check"><input type="checkbox" name="interventionTypes" value={t} defaultChecked={p.interventionTypes.includes(t)} /> {t}</label>
          ))}
        </div>
      </fieldset>
      <label>Tarif journalier indicatif (€ HT)<input name="dayRate" inputMode="decimal" defaultValue={p.dayRateCents != null ? String(p.dayRateCents / 100) : ""} />
        <span className="hint">Visible uniquement des organisations. Sert de base à la vérification de juste contrepartie.</span>
      </label>
      <button className="btn" disabled={pending}>{pending ? "Enregistrement…" : "Enregistrer le profil expert"}</button>
    </form>
  );
}
