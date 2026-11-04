"use client";

import { useActionState, useState, useTransition } from "react";
import { createInvitation, createOrganization, removeOrgLogo, setMemberRoles, submitSiren, updateOrganization, updateExpertProfile, updateOrgLogo, type InviteState } from "@/lib/org-actions";
import { Avatar } from "@/components/Avatar";
import { Notice } from "@/components/AuthForms";
import { ActionForm } from "@/components/ActionForm";
import { useT } from "@/components/I18nProvider";

type Opt = { value: string; label: string };

export function NewOrgForm({ kinds }: { kinds: Opt[] }) {
  const [state, action, pending] = useActionState(createOrganization, undefined);
  return (
    <ActionForm action={action} className="card form">
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
    </ActionForm>
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
  const t = useT();
  return (
    <form action={action} className="card form">
      <h2>{t("Profil expert")}</h2>
      <p className="muted">{t("Ces informations apparaissent dans l'annuaire, consulté par les organisations.")}</p>
      <Notice state={state} />
      <label>{t("Présentation")}<textarea name="bio" rows={4} defaultValue={p.bio ?? ""} placeholder={t("Parcours, domaines d'expertise, publications marquantes…")} /></label>
      <div className="row">
        <label>{t("Établissement / cabinet")}<input name="hospital" defaultValue={p.hospital ?? ""} /></label>
        <label>{t("Sur-spécialité")}<input name="subspecialty" defaultValue={p.subspecialty ?? ""} /></label>
      </div>
      <div className="row">
        <label>{t("Langues")}<input name="languages" defaultValue={p.languages.join(", ")} placeholder="fr, en" /></label>
        <label>ORCID<input name="orcid" defaultValue={p.orcid ?? ""} placeholder="0000-0000-0000-0000" /></label>
      </div>
      <fieldset>
        <legend>{t("Types d'intervention")}</legend>
        <div className="checks">
          {types.map((type) => (
            <label key={type} className="check"><input type="checkbox" name="interventionTypes" value={type} defaultChecked={p.interventionTypes.includes(type)} /> {t(type)}</label>
          ))}
        </div>
      </fieldset>
      <label>{t("Tarif journalier indicatif (€ HT)")}<input name="dayRate" inputMode="decimal" defaultValue={p.dayRateCents != null ? String(p.dayRateCents / 100) : ""} />
        <span className="hint">{t("Visible uniquement des organisations. Sert de base à la vérification de juste contrepartie.")}</span>
      </label>
      <button className="btn" disabled={pending}>{pending ? t("Enregistrement…") : t("Enregistrer le profil expert")}</button>
    </form>
  );
}

type Verification = { status: "PENDING" | "VERIFIED" | "REJECTED" | "SUSPENDED"; siren: string | null; legalName: string | null; note: string | null };

/** Validation de l'organisation par KolBase : statut et saisie du SIREN (administrateurs). */
export function VerificationCard({ orgId, v, canEdit }: { orgId: string; v: Verification; canEdit: boolean }) {
  const [state, action, pending] = useActionState(submitSiren, undefined);
  const label = { PENDING: "En attente de validation", VERIFIED: "Validée par KolBase", REJECTED: "Refusée", SUSPENDED: "Suspendue par KolBase" }[v.status];
  const tone = { PENDING: "wait", VERIFIED: "ok", REJECTED: "bad", SUSPENDED: "bad" }[v.status];
  // Suspendue : seule l'équipe KolBase lève la suspension (pas de nouvelle demande de validation).
  if (v.status === "SUSPENDED")
    return (
      <section className="card form">
        <h2>Validation de l&apos;organisation <span className={`pill ${tone}`}>{label}</span></h2>
        <p className="notice error">Organisation suspendue{v.note ? ` : ${v.note}` : ""}.</p>
        <p className="muted">
          Votre page publique, vos événements et vos appels à candidatures sont masqués, et aucune nouvelle action n&apos;est possible
          (sollicitation, publication, demande de devis). Rien n&apos;est supprimé : tout réapparaît à la réactivation par KolBase.
          Pour en discuter, répondez à l&apos;e-mail de suspension.
        </p>
      </section>
    );
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

/** Rôles d'un membre : chaque case cochée ou décochée est enregistrée aussitôt ; le retrait demande une confirmation. */
export function MemberRolesForm({ orgId, userId, roles, options, canRemove }: { orgId: string; userId: string; roles: string[]; options: (Opt & { desc?: string })[]; canRemove: boolean }) {
  const [checked, setChecked] = useState(roles);
  const [confirming, setConfirming] = useState(false);
  const [state, action, pending] = useActionState(async (prev: Awaited<ReturnType<typeof setMemberRoles>>, fd: FormData) => {
    const r = await setMemberRoles(prev, fd);
    // Refus (dernier administrateur, aucun rôle) : les cases reviennent à l'état enregistré.
    if (r?.error) setChecked(roles);
    return r;
  }, undefined);
  const [isPending, startTransition] = useTransition();
  const submit = (next: string[], remove = false) => {
    const fd = new FormData();
    fd.set("orgId", orgId);
    fd.set("userId", userId);
    next.forEach((r) => fd.append("role", r));
    if (remove) fd.set("remove", "1");
    startTransition(() => action(fd));
  };
  const busy = pending || isPending;
  return (
    <div className="member-roles">
      <div className="role-chips" role="group" aria-label="Rôles">
        {options.map((o) => (
          <label key={o.value} className="role-chip" title={o.desc}>
            <input
              type="checkbox"
              value={o.value}
              checked={checked.includes(o.value)}
              disabled={busy}
              onChange={(e) => {
                const next = e.target.checked ? [...checked, o.value] : checked.filter((r) => r !== o.value);
                setChecked(next);
                submit(next);
              }}
            />
            <span>{o.label}</span>
          </label>
        ))}
      </div>
      <div className="actions">
        {canRemove && !confirming && <button type="button" className="link danger" disabled={busy} onClick={() => setConfirming(true)}>Retirer de l&apos;organisation</button>}
        {canRemove && confirming && (
          <>
            <button type="button" className="btn small danger" disabled={busy} onClick={() => submit([], true)}>Confirmer le retrait</button>
            <button type="button" className="link" onClick={() => setConfirming(false)}>Annuler</button>
          </>
        )}
        {busy ? <span className="text-xs muted" role="status">Enregistrement…</span> : (state?.error || state?.ok) && <span className={`text-xs ${state?.error ? "error-text" : "muted"}`} role="status">{state?.error ?? state?.ok}</span>}
      </div>
    </div>
  );
}
