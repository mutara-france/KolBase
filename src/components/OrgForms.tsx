"use client";

import { inSentence } from "@/lib/elision";
import { useActionState, useState, useTransition } from "react";
import { createInvitation, createOrganization, removeOrgLogo, setMemberRoles, submitSiren, updateOrganization, updateExpertProfile, updateOrgLogo, type InviteState } from "@/lib/org-actions";
import { Avatar } from "@/components/Avatar";
import { Notice } from "@/components/AuthForms";
import { ActionForm } from "@/components/ActionForm";
import { useT } from "@/components/I18nProvider";

type Opt = { value: string; label: string };

/** Création d'une organisation : traduite (le reste de l'espace organisation est en français). */
export function NewOrgForm({ kinds }: { kinds: Opt[] }) {
  const [state, action, pending] = useActionState(createOrganization, undefined);
  const t = useT();
  return (
    <ActionForm action={action} className="card form">
      <h1>{t("Créer une organisation")}</h1>
      <p className="muted">{t("Vous en serez l'administrateur et pourrez ensuite inviter vos collègues.")}</p>
      <Notice state={state} />
      <label>{t("Nom de l'organisation")}<input name="name" maxLength={120} required /></label>
      <label>{t("Type")}
        <select name="kind" defaultValue="INDUSTRIEL">{kinds.map((k) => <option key={k.value} value={k.value}>{k.label}</option>)}</select>
      </label>
      <div className="row">
        <label>{t("Secteur")}<input name="sector" placeholder={t("Dispositifs médicaux…")} /></label>
        <label>{t("Siège")}<input name="headquarters" placeholder={t("Lyon, France")} /></label>
      </div>
      <label>{t("SIREN, SIRET ou RNA")}<input name="siren" placeholder={t("9 ou 14 chiffres, ou W suivi de 9 chiffres")} />
        <span className="hint">{t("SIREN obligatoire pour un industriel, un organisme de formation ou un prestataire. Facultatif pour une société savante ou une association, qui peut aussi indiquer son numéro RNA. KolBase le contrôle, puis valide l'organisation avant qu'elle puisse solliciter des praticiens ou publier.")}</span>
      </label>
      <label>{t("E-mail de contact")}<input name="contactEmail" type="email" /></label>
      <button className="btn" disabled={pending}>{pending ? t("Création…") : t("Créer l'organisation")}</button>
    </ActionForm>
  );
}

type Org = { id: string; name: string; sector: string | null; headquarters: string | null; contactEmail: string | null; about: string | null; policy: string | null; areas: string[] };

/** Fiche de l'organisation ; prestataire (`supplier`) : ni domaines thérapeutiques ni politique de collaboration. */
export function EditOrgForm({ org, supplier = false }: { org: Org; supplier?: boolean }) {
  const t = useT();
  const [state, action, pending] = useActionState(updateOrganization, undefined);
  return (
    <form action={action} className="card form">
      <h2>{t("Fiche de l'organisation")}</h2>
      <Notice state={state} />
      <input type="hidden" name="orgId" value={org.id} />
      <label>{t("Nom")}<input name="name" maxLength={120} defaultValue={org.name} required /></label>
      <div className="row">
        <label>{t("Secteur")}<input name="sector" defaultValue={org.sector ?? ""} /></label>
        <label>{t("Siège")}<input name="headquarters" defaultValue={org.headquarters ?? ""} /></label>
      </div>
      <label>{t("E-mail de contact")}<input name="contactEmail" type="email" defaultValue={org.contactEmail ?? ""} /></label>
      {supplier ? (
        <input type="hidden" name="areas" value={org.areas.join(", ")} />
      ) : (
        <label>{t("Domaines thérapeutiques")}<input name="areas" defaultValue={org.areas.join(", ")} placeholder={t("Implantologie, Parodontologie…")} />
          <span className="hint">{t("Séparés par des virgules.")}</span>
        </label>
      )}
      <label>{t("Présentation")}<textarea name="about" rows={3} defaultValue={org.about ?? ""} placeholder={supplier ? t("Vos prestations, votre savoir-faire, vos références…") : undefined} /></label>
      {supplier ? <input type="hidden" name="policy" value={org.policy ?? ""} /> : <label>{t("Politique de collaboration")}<textarea name="policy" rows={3} defaultValue={org.policy ?? ""} /></label>}
      <button className="btn" disabled={pending}>{pending ? t("Enregistrement…") : t("Enregistrer")}</button>
    </form>
  );
}

export function InviteForm({ orgId, roles }: { orgId: string; roles: Opt[] }) {
  const t = useT();
  const [state, action, pending] = useActionState<InviteState, FormData>(createInvitation, undefined);
  const [copied, setCopied] = useState(false);
  return (
    <form action={action} className="card form">
      <h2>{t("Inviter un membre")}</h2>
      <p className="muted">{t("KolBase génère un lien d'invitation, valable 14 jours et à usage unique. Avec une adresse, l'invitation part par e-mail et seule cette adresse peut l'accepter ; sans adresse, transmettez le lien vous-même.")}</p>
      <Notice state={state} />
      {state?.link && (
        <div className="copy">
          <input readOnly value={state.link} onFocus={(e) => e.currentTarget.select()} />
          <button type="button" className="btn ghost" onClick={() => { navigator.clipboard.writeText(state.link!); setCopied(true); }}>
            {copied ? t("Copié") : t("Copier")}
          </button>
        </div>
      )}
      <input type="hidden" name="orgId" value={orgId} />
      <div className="row">
        <label>{t("Rôle")}
          <select name="role" defaultValue={roles.find((r) => r.value !== "ADMIN")?.value}>{roles.map((r) => <option key={r.value} value={r.value}>{r.label}</option>)}</select>
        </label>
        <label>{t("E-mail de la personne invitée (l'invitation lui est envoyée et réservée)")}<input name="email" type="email" placeholder={t("Facultatif")} /></label>
      </div>
      <button className="btn" disabled={pending} onClick={() => setCopied(false)}>{pending ? t("Génération…") : t("Générer le lien")}</button>
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
        <label>{t("Langues")}<input name="languages" defaultValue={p.languages.join(", ")} placeholder={t("fr, en")} /></label>
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

type Verification = {
  status: "PENDING" | "VERIFIED" | "REJECTED" | "SUSPENDED"; siren: string | null; legalName: string | null; note: string | null;
  /** Prestataire : la validation ouvre les réponses aux devis et l'annuaire des prestataires. */ supplier?: boolean;
  /** Association ou société savante : RNA accepté, SIREN facultatif. */ rnaAccepted?: boolean; rna?: string | null;
  /** Date de la demande transmise à KolBase (« 4 nov. 2026 »), en attente seulement. */ requestedAt?: string | null;
};

/** Validation de l'organisation par KolBase : statut et saisie du SIREN (administrateurs). */
export function VerificationCard({ orgId, v, canEdit }: { orgId: string; v: Verification; canEdit: boolean }) {
  const t = useT();
  const [state, action, pending] = useActionState(submitSiren, undefined);
  const label = { PENDING: "En attente de validation", VERIFIED: "Validée par KolBase", REJECTED: "Refusée", SUSPENDED: "Suspendue par KolBase" }[v.status];
  const tone = { PENDING: "wait", VERIFIED: "ok", REJECTED: "bad", SUSPENDED: "bad" }[v.status];
  // Suspendue : seule l'équipe KolBase lève la suspension (pas de nouvelle demande de validation).
  if (v.status === "SUSPENDED")
    return (
      <section className="card form">
        <h2>{t("Validation de l'organisation")}{" "}<span className={`pill ${tone}`}>{t(label)}</span></h2>
        <p className="notice error">{t("Organisation suspendue")}{v.note ? ` : ${inSentence(v.note)}` : ""}.</p>
        <p className="muted">
          {t("Votre page publique, vos événements et vos appels à candidatures sont masqués, et aucune nouvelle action n'est possible (sollicitation, publication, demande de devis). Rien n'est supprimé : tout réapparaît à la réactivation par KolBase. Pour en discuter, répondez à l'e-mail de suspension.")}
        </p>
      </section>
    );
  return (
    <section className="card form">
      <h2>{t("Validation de l'organisation")}{" "}<span className={`pill ${tone}`}>{t(label)}</span></h2>
      {v.status === "VERIFIED" ? (
        <p className="muted">
          {v.legalName ? t("Raison sociale : {legalName}", { legalName: v.legalName }) : t("Organisation validée")}{v.siren ? ` · SIREN ${v.siren}` : ""}. {t("Modifier le nom ou le SIREN relance la validation.")}
        </p>
      ) : (
        <>
          {/* Demande déjà transmise : la date, et non un nouvel « Envoyer pour validation ». */}
          {v.status === "PENDING" && v.requestedAt && (
            <p className="notice ok" role="status">
              {t("Demande transmise le {requestedAt}", { requestedAt: v.requestedAt })}{v.siren ? ` (SIREN ${v.siren})` : v.rna ? ` (RNA ${v.rna})` : ""}{" "}{t(": l'équipe KolBase l'examine et vous prévient par e-mail de sa décision.")}
            </p>
          )}
          <p className="muted">
            {v.supplier
              ? t("Tant que KolBase n'a pas validé l'organisation, elle ne peut ni répondre aux demandes de devis, ni figurer dans l'annuaire des prestataires.")
              : t("Tant que KolBase n'a pas validé l'organisation, elle ne peut ni solliciter de praticiens, ni publier d'événements ou d'appels, ni apparaître sur le site public.")}
            {v.status === "REJECTED" && v.note ? ` ${t("Motif du refus : {inSentence}.", { inSentence: inSentence(v.note) })}` : ""}
          </p>
        </>
      )}
      {canEdit && (
        <form action={action} className="stack-sm">
          <Notice state={state} />
          <input type="hidden" name="orgId" value={orgId} />
          <div className="row">
            <label>
              {v.rnaAccepted ? t("SIREN, SIRET ou RNA") : t("SIREN ou SIRET")}
              <input name="siren" defaultValue={v.siren ?? v.rna ?? ""} placeholder={v.rnaAccepted ? t("9 ou 14 chiffres, ou W suivi de 9 chiffres") : t("9 ou 14 chiffres")} required />
            </label>
            <button className="btn secondary" disabled={pending} style={{ alignSelf: "end" }}>
              {pending ? t("Contrôle…") : v.status === "VERIFIED" || (v.status === "PENDING" && v.requestedAt) ? t("Mettre à jour") : t("Envoyer pour validation")}
            </button>
          </div>
          {v.status === "PENDING" && v.requestedAt && <span className="hint">{t("Corrigez l'identifiant seulement s'il est faux : la demande en cours suffit.")}</span>}
        </form>
      )}
    </section>
  );
}

/** Logo de l'organisation : aperçu, envoi d'une nouvelle image, suppression. */
export function LogoForm({ orgId, name, src, verified, supplier = false }: { orgId: string; name: string; src: string | null; verified: boolean; supplier?: boolean }) {
  const t = useT();
  const [state, action, pending] = useActionState(updateOrgLogo, undefined);
  return (
    <section className="card form">
      <h2>{t("Logo")}</h2>
      <Notice state={state} />
      <div className="actions" style={{ alignItems: "center" }}>
        <Avatar name={name} size={64} square src={src} />
        <p className="muted text-sm" style={{ margin: 0 }}>
          {t("PNG, JPEG ou WebP, 500 Ko au plus, de préférence carré sur fond clair. Il remplace le monogramme")}{" "}{supplier ? t("sur votre page prestataire, dans l'annuaire des prestataires et sur vos devis.") : t("sur votre fiche, l'annuaire des organisations et les appels publiés.")}
          {!verified && t(" Il ne sera visible publiquement qu'après la validation de l'organisation.")}{" "}{t("Ne publiez que le logo de votre propre organisation.")}
        </p>
      </div>
      <form action={action} className="inline wrap">
        <input type="hidden" name="orgId" value={orgId} />
        <label className="sr-only" htmlFor="logo-file">{t("Fichier du logo")}</label>
        <input id="logo-file" name="logo" type="file" accept="image/png,image/jpeg,image/webp" required />
        <button className="btn secondary" disabled={pending}>{pending ? t("Envoi…") : src ? t("Remplacer") : t("Ajouter le logo")}</button>
      </form>
      {src && (
        <form action={removeOrgLogo}>
          <input type="hidden" name="orgId" value={orgId} />
          <button className="link danger">{t("Retirer le logo")}</button>
        </form>
      )}
    </section>
  );
}

/** Rôles d'un membre : chaque case cochée ou décochée est enregistrée aussitôt ; le retrait demande une confirmation. */
export function MemberRolesForm({ orgId, userId, roles, options, canRemove }: { orgId: string; userId: string; roles: string[]; options: (Opt & { desc?: string })[]; canRemove: boolean }) {
  const t = useT();
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
      <div className="role-chips" role="group" aria-label={t("Rôles")}>
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
        {canRemove && !confirming && <button type="button" className="link danger" disabled={busy} onClick={() => setConfirming(true)}>{t("Retirer de l'organisation")}</button>}
        {canRemove && confirming && (
          <>
            <button type="button" className="btn small danger" disabled={busy} onClick={() => submit([], true)}>{t("Confirmer le retrait")}</button>
            <button type="button" className="link" onClick={() => setConfirming(false)}>{t("Annuler")}</button>
          </>
        )}
        {busy ? <span className="text-xs muted" role="status">{t("Enregistrement…")}</span> : (state?.error || state?.ok) && <span className={`text-xs ${state?.error ? "error-text" : "muted"}`} role="status">{state?.error ?? state?.ok}</span>}
      </div>
    </div>
  );
}
