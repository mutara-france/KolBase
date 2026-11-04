"use client";

import { useActionState, useState } from "react";
import { changePassword, deleteAccount, resendVerification, setListed, updateNotifyPrefs, updateProfile } from "@/lib/auth-actions";
import { Notice } from "@/components/AuthForms";
import { PROFESSIONS } from "@/lib/professions";
import { COUNTRIES, licenseRule } from "@/lib/countries";
import { useT } from "@/components/I18nProvider";

type Props = {
  user: { firstName: string; lastName: string; email: string; phone: string | null; locale: string };
  practitioner: {
    profession: string; rpps: string | null; country: string; licenseNumber: string | null; city: string | null; specialty: string | null; listed: boolean;
    rppsStatus: "none" | "pending" | "verified" | "rejected"; rppsNote: string | null;
  } | null;
};

export function ProfileForm({ user, practitioner }: Props) {
  const [state, action, pending] = useActionState(updateProfile, undefined);
  const t = useT();
  const [countryCode, setCountryCode] = useState(practitioner?.country ?? "FR");
  const rule = countryCode === "FR" ? null : licenseRule(countryCode);
  // Le numéro saisi n'est conservé que si le pays d'exercice n'a pas changé.
  const sameCountry = countryCode === practitioner?.country;
  return (
    <form action={action} className="card form">
      <h2>{t("Informations personnelles")}</h2>
      <Notice state={state} />
      <div className="row">
        <label>{t("Prénom")}<input name="firstName" maxLength={120} defaultValue={user.firstName} required /></label>
        <label>{t("Nom")}<input name="lastName" maxLength={120} defaultValue={user.lastName} required /></label>
      </div>
      <div className="row">
        <label>{t("Téléphone")}<input name="phone" type="tel" defaultValue={user.phone ?? ""} /></label>
        <label>{t("Langue de l'interface et des e-mails")}
          <select name="locale" defaultValue={user.locale}><option value="fr">Français</option><option value="en">English</option></select>
        </label>
      </div>
      {practitioner && (
        <>
          <div className="row">
            <label>{t("Profession")}
              <select name="profession" defaultValue={practitioner.profession}>
                {[...new Set([...PROFESSIONS, practitioner.profession])].map((p) => <option key={p} value={p}>{t(p)}</option>)}
              </select>
            </label>
            <label>{t("Pays d'exercice")}
              <select name="country" value={countryCode} onChange={(e) => setCountryCode(e.target.value)}>
                {COUNTRIES.map((c) => <option key={c.code} value={c.code}>{t(c.name)}</option>)}
              </select>
              <span className="hint">{t("Si vous exercez aussi en France, choisissez la France et indiquez votre RPPS.")}</span>
            </label>
          </div>
          <div className="row">
            {rule ? (
              <label key={`lic-${countryCode}`}>{t(rule.label)}<input name="licenseNumber" maxLength={120} defaultValue={sameCountry ? practitioner.licenseNumber ?? "" : ""} />
                <span className="hint">{t(rule.hint)}</span>
                <IdStatus p={practitioner} show={sameCountry} />
              </label>
            ) : (
              <label key="rpps">{t("N° RPPS")}<input name="rpps" inputMode="numeric" pattern="[0-9 ]{11,14}" title={t("11 chiffres")} defaultValue={sameCountry ? practitioner.rpps ?? "" : ""} />
                <IdStatus p={practitioner} show={sameCountry} />
              </label>
            )}
          </div>
          <div className="row">
            <label>{t("Ville d'exercice")}<input name="city" defaultValue={practitioner.city ?? ""} /></label>
            <label>{t("Spécialité / domaine")}<input name="specialty" defaultValue={practitioner.specialty ?? ""} /></label>
          </div>
        </>
      )}
      <button className="btn" disabled={pending}>{pending ? t("Enregistrement…") : t("Enregistrer")}</button>
    </form>
  );
}

/** État de la vérification de l'identifiant professionnel (RPPS ou identifiant étranger). */
function IdStatus({ p, show }: { p: NonNullable<Props["practitioner"]>; show: boolean }) {
  const t = useT();
  const status = show ? p.rppsStatus : "none";
  return (
    <span className="hint">
      {status === "verified" && t("Vérifié par KolBase : badge « Identité vérifiée » affiché.")}
      {status === "pending" && t("En cours de vérification par KolBase.")}
      {status === "rejected" &&
        (p.rppsNote
          ? t("Non validé : {note}. Corrigez le numéro pour une nouvelle vérification.", { note: p.rppsNote })
          : t("Non validé. Corrigez le numéro pour une nouvelle vérification."))}
      {status === "none" && t("Nécessaire pour être référencé comme expert ; vérifié par KolBase.")}
    </span>
  );
}

export function PasswordForm({ email }: { email: string }) {
  const [state, action, pending] = useActionState(changePassword, undefined);
  const t = useT();
  return (
    <form action={action} className="card form">
      <h2>{t("Identifiants de connexion")}</h2>
      <p className="muted">{t("E-mail de connexion :")} <strong>{email}</strong></p>
      <Notice state={state} />
      <label>{t("Mot de passe actuel")}<input name="current" type="password" autoComplete="current-password" required /></label>
      <div className="row">
        <label>{t("Nouveau mot de passe")}<input name="next" type="password" autoComplete="new-password" minLength={10} required /></label>
        <label>{t("Confirmation")}<input name="confirm" type="password" autoComplete="new-password" minLength={10} required /></label>
      </div>
      <button className="btn" disabled={pending}>{pending ? t("Modification…") : t("Changer le mot de passe")}</button>
    </form>
  );
}

/** Référencement comme expert ; `idMissing` : identifiant professionnel à renseigner d'abord (RPPS, ou celui du pays d'exercice). */
export function ListingForm({ listed, eligible, idMissing, rpps }: {
  listed: boolean; eligible: boolean; idMissing: string | null;
  /** Praticien exerçant en France : son RPPS se renseigne et se suit dans cet encart (prérequis du référencement). */
  rpps?: { value: string | null; status: "none" | "pending" | "verified" | "rejected"; note: string | null } | null;
}) {
  const [state, action, pending] = useActionState(setListed, undefined);
  const t = useT();
  if (!listed && !eligible)
    return (
      <section className="card">
        <h2>{t("Référencement comme expert")}</h2>
        <p className="muted">{t("Le référencement comme expert (KOL) est réservé aux chirurgiens-dentistes, orthodontistes, chirurgiens oraux et stomatologues. Votre compte vous permet de vous inscrire aux événements.")}</p>
      </section>
    );
  return (
    <form action={action} className={`card form ${listed ? "" : "highlight"}`}>
      <h2>{listed ? t("Vous êtes référencé comme expert") : t("Devenir expert référencé (KOL)")}</h2>
      <Notice state={state} />
      {listed ? (
        <p className="muted">{t("Votre profil est visible dans l'annuaire et sur le site public. Les organisations peuvent vous solliciter ; chaque collaboration fera l'objet d'une convention déclarée.")}</p>
      ) : (
        <ul className="muted">
          <li>{t("Votre profil apparaît dans l'annuaire des experts et sur le site public.")}</li>
          <li>{t("Vous recevez des sollicitations et accédez aux opportunités.")}</li>
          <li>{t("Toute rémunération ou avantage reçu fera l'objet d'une convention, que l'organisation déclare sur Transparence Santé.")}</li>
          {idMissing && !rpps && <li><strong>{t("Prérequis : renseignez votre {id}", { id: t(idMissing) })}</strong> {t("(Informations personnelles, plus bas).")}</li>}
        </ul>
      )}
      {rpps && !rpps.value && !listed && (
        <label>{t("N° RPPS (prérequis, vérifié par KolBase)")}<input name="rpps" inputMode="numeric" pattern="[0-9 ]{11,14}" title={t("11 chiffres")} /></label>
      )}
      {rpps && !rpps.value && listed && <p className="text-sm">{t("N° RPPS : non renseigné, à indiquer dans Informations personnelles pour le badge « Identité vérifiée ».")}</p>}
      {rpps?.value && (
        <p className="text-sm">
          {t("N° RPPS : {rpps}", { rpps: rpps.value })} ·{" "}
          {rpps.status === "verified" ? t("Vérifié par KolBase : badge « Identité vérifiée » affiché.")
            : rpps.status === "pending" ? t("En cours de vérification par KolBase.")
            : rpps.note ? t("Non validé : {note}. Corrigez le numéro pour une nouvelle vérification.", { note: rpps.note }) : t("Non validé. Corrigez le numéro pour une nouvelle vérification.")}
          {" "}<span className="hint">{t("(modifiable dans Informations personnelles)")}</span>
        </p>
      )}
      <input type="hidden" name="listed" value={listed ? "0" : "1"} />
      <button className={listed ? "btn ghost" : "btn"} disabled={pending}>
        {listed ? t("Retirer mon référencement") : t("Me référencer comme expert")}
      </button>
    </form>
  );
}

/** Adresse non confirmée : rappel et renvoi du lien. */
export function EmailVerificationNotice({ email }: { email: string }) {
  const [state, action, pending] = useActionState(resendVerification, undefined);
  const t = useT();
  return (
    <form action={action} className="notice warn">
      {t("Confirmez votre adresse")} <strong>{email}</strong> {t(": un lien vous a été envoyé. Sans confirmation, vous ne recevez pas la lettre d'information ; le reste de KolBase fonctionne normalement.")}{" "}
      {state?.ok || state?.error ? <span>{state.ok ?? state.error}</span> : <button className="link" disabled={pending}>{t("Renvoyer le lien")}</button>}
    </form>
  );
}

/** Renvoi du lien de confirmation d'adresse, en une ligne (encart de la lettre d'information). */
export function ResendVerificationLink() {
  const [state, action, pending] = useActionState(resendVerification, undefined);
  const t = useT();
  return (
    <form action={action} className="inline">
      {state?.ok || state?.error ? <span>{state.ok ?? state.error}</span> : <button className="link" disabled={pending}>{t("Renvoyer le lien")}</button>}
    </form>
  );
}

export function NotificationsForm({ email, newsletter = false }: { email: boolean; newsletter?: boolean }) {
  const [state, action, pending] = useActionState(updateNotifyPrefs, undefined);
  const t = useT();
  return (
    <form action={action} className="card form">
      <h2>{t("Notifications")}</h2>
      <Notice state={state} />
      <label className="check">
        <input type="checkbox" name="email" value="1" defaultChecked={email} /> {t("Recevoir par e-mail les sollicitations, réponses, messages, candidatures et devis")}
      </label>
      <label className="check">
        <input type="checkbox" name="newsletter" value="1" defaultChecked={newsletter} /> {t("Recevoir la lettre d'information de KolBase : événements scientifiques et nouveautés (deux envois par mois au plus)")}
      </label>
      <p className="hint">{t("Les e-mails de service (mot de passe, confirmation d'adresse, invitations) sont toujours envoyés. La lettre d'information peut présenter des événements d'organisations partenaires ; chaque envoi contient un lien de désinscription.")}</p>
      <button className="btn secondary" disabled={pending}>{t("Enregistrer")}</button>
    </form>
  );
}

/** Mes données : export (portabilité) et suppression du compte (anonymisation). */
export function MyDataCard({ keep }: { keep: { conventions: number; hospitalities: number; feeNotes: number } }) {
  const [state, action, pending] = useActionState(deleteAccount, undefined);
  const t = useT();
  const kept = keep.conventions + keep.hospitalities > 0;
  // « 2 convention(s) et 1 hospitalité(s) » : seules les parties non nulles.
  const keptItems = [
    keep.conventions ? t("{n} convention(s)", { n: keep.conventions }) : "",
    keep.hospitalities ? t("{n} hospitalité(s)", { n: keep.hospitalities }) : "",
  ].filter(Boolean).join(` ${t("et")} `);
  return (
    <section className="card form">
      <h2>{t("Mes données")}</h2>
      <p className="muted">{t("Téléchargez l'ensemble des données de votre compte (profil, publications, inscriptions, collaborations, messages, liens d'intérêts déclarés, notes d'honoraires) au format JSON.")}</p>
      <div className="actions"><a className="btn ghost" href="/compte/export">{t("Télécharger mes données")}</a></div>
      <details>
        <summary>{t("Supprimer mon compte")}</summary>
        <form action={action} className="stack-sm">
          <p className="muted">
            {t("La suppression est définitive : vous ne pourrez plus vous connecter, votre fiche est retirée ; vos publications, coordonnées, coordonnées de facturation (IBAN, adresse, SIRET, TVA), liens d'intérêts déclarés, suivis et candidatures en attente sont effacés, vos inscriptions à venir annulées et vos sollicitations en attente déclinées.")}
            {" "}
            {kept
              ? t("Votre nom, votre profession, votre RPPS, votre ville et votre structure de facturation restent attachés à vos {items} signées ou déclarées : les organisations doivent les conserver (dispositif anti-cadeaux, Transparence Santé).", { items: keptItems })
              : t("Aucune convention signée ni hospitalité n'est attachée à votre compte : votre nom est également effacé.")}
            {keep.feeNotes > 0 && <>{" "}{t("Vos notes d'honoraires déjà établies ({n}) restent chez les organisations, telles qu'émises (pièces comptables).", { n: keep.feeNotes })}</>}
          </p>
          <Notice state={state} />
          <label>{t("Mot de passe")}<input name="password" type="password" autoComplete="current-password" required /></label>
          <label className="check"><input type="checkbox" name="confirm" value="1" required /> {t("Je comprends que la suppression est définitive.")}</label>
          <button className="btn danger" disabled={pending}>{pending ? t("Suppression…") : t("Supprimer définitivement mon compte")}</button>
        </form>
      </details>
    </section>
  );
}
