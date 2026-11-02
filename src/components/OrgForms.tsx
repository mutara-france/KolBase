"use client";

import { useActionState, useState } from "react";
import { createInvitation, createOrganization, removeOrgLogo, submitSiren, updateOrganization, updateExpertProfile, updateOrgLogo, type InviteState } from "@/lib/org-actions";
import { Avatar } from "@/components/Avatar";
import { Notice } from "@/components/AuthForms";

type Opt = { value: string; label: string };

export function NewOrgForm({ kinds }: { kinds: Opt[] }) {
  const [state, action, pending] = useActionState(createOrganization, undefined);
  return (
    <form action={action} className="card form">
      <h1>Créer une organisation</h1>
      <p className="muted">Vous en serez l&apos;administrateur et pourrez ensuite inviter vos collègues.</p>
      <Notice state={state} />
      <label>Nom de l&apos;organisation<input name="name" maxLength={120} required /></label>
      <label>Type
        <select name="kind" defaultValue="INDUSTRIEL">{kinds.map((k) => <option key={k.value} value={k.value}>{k.label}</option>)}</select>
      </label>
      <div className="row">
        <label>Secteur<input name="sector" placeholder="Dispositifs médicaux…" /></label>
        <label>Siège<input name="headquarters" placeholder="Lyon, France" /></label>
      </div>
      <label>SIREN ou SIRET<input name="siren" inputMode="numeric" placeholder="9 ou 14 chiffres" />
        <span className="hint">Obligatoire pour un industriel, un organisme de formation ou un prestataire. KolBase le contrôle dans le répertoire des entreprises, puis valide l&apos;organisation avant qu&apos;elle puisse solliciter des praticiens ou publier.</span>
      </label>
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
      <label>Nom<input name="name" maxLength={120} defaultValue={org.name} required /></label>
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
      <p className="muted">KolBase génère un lien d&apos;invitation à transmettre vous-même à la personne.</p>
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
          <select name="role" defaultValue={roles.find((r) => r.value !== "ADMIN")?.value}>{roles.map((r) => <option key={r.value} value={r.value}>{r.label}</option>)}</select>
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

type Verification = { status: "PENDING" | "VERIFIED" | "REJECTED"; siren: string | null; legalName: string | null; note: string | null };

/** Validation de l'organisation par KolBase : statut et saisie du SIREN (administrateurs). */
export function VerificationCard({ orgId, v, canEdit }: { orgId: string; v: Verification; canEdit: boolean }) {
  const [state, action, pending] = useActionState(submitSiren, undefined);
  const label = { PENDING: "En attente de validation", VERIFIED: "Validée par KolBase", REJECTED: "Refusée" }[v.status];
  const tone = { PENDING: "wait", VERIFIED: "ok", REJECTED: "bad" }[v.status];
  return (
    <section className="card form">
      <h2>Validation de l&apos;organisation <span className={`pill ${tone}`}>{label}</span></h2>
      {v.status === "VERIFIED" ? (
        <p className="muted">
          {v.legalName ? `Raison sociale : ${v.legalName}` : "Organisation validée"}{v.siren ? ` · SIREN ${v.siren}` : ""}. Modifier le nom ou le SIREN relance la validation.
        </p>
      ) : (
        <p className="muted">
          Tant que KolBase n&apos;a pas validé l&apos;organisation, elle ne peut ni solliciter de praticiens, ni publier d&apos;événements ou d&apos;appels, ni apparaître sur le site public.
          {v.status === "REJECTED" && v.note ? ` Motif du refus : ${v.note}.` : ""}
        </p>
      )}
      {canEdit && (
        <form action={action} className="stack-sm">
          <Notice state={state} />
          <input type="hidden" name="orgId" value={orgId} />
          <div className="row">
            <label>SIREN ou SIRET<input name="siren" inputMode="numeric" defaultValue={v.siren ?? ""} placeholder="9 ou 14 chiffres" required /></label>
            <button className="btn secondary" disabled={pending} style={{ alignSelf: "end" }}>{pending ? "Contrôle…" : v.status === "VERIFIED" ? "Mettre à jour" : "Envoyer pour validation"}</button>
          </div>
        </form>
      )}
    </section>
  );
}

/** Logo de l'organisation : aperçu, envoi d'une nouvelle image, suppression. */
export function LogoForm({ orgId, name, src, verified }: { orgId: string; name: string; src: string | null; verified: boolean }) {
  const [state, action, pending] = useActionState(updateOrgLogo, undefined);
  return (
    <section className="card form">
      <h2>Logo</h2>
      <Notice state={state} />
      <div className="actions" style={{ alignItems: "center" }}>
        <Avatar name={name} size={64} square src={src} />
        <p className="muted text-sm" style={{ margin: 0 }}>
          PNG, JPEG ou WebP, 500 Ko au plus, de préférence carré sur fond clair. Il remplace le monogramme sur votre fiche, l&apos;annuaire des organisations et les appels publiés.
          {!verified && " Il ne sera visible publiquement qu'après la validation de l'organisation."} Ne publiez que le logo de votre propre organisation.
        </p>
      </div>
      <form action={action} className="inline wrap">
        <input type="hidden" name="orgId" value={orgId} />
        <label className="sr-only" htmlFor="logo-file">Fichier du logo</label>
        <input id="logo-file" name="logo" type="file" accept="image/png,image/jpeg,image/webp" required />
        <button className="btn secondary" disabled={pending}>{pending ? "Envoi…" : src ? "Remplacer" : "Ajouter le logo"}</button>
      </form>
      {src && (
        <form action={removeOrgLogo}>
          <input type="hidden" name="orgId" value={orgId} />
          <button className="link danger">Retirer le logo</button>
        </form>
      )}
    </section>
  );
}
