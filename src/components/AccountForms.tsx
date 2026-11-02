"use client";

import { useActionState, useState } from "react";
import { changePassword, deleteAccount, resendVerification, setListed, updateNotifyPrefs, updateProfile } from "@/lib/auth-actions";
import { Notice } from "@/components/AuthForms";
import { PROFESSIONS } from "@/lib/professions";
import { COUNTRIES, licenseRule } from "@/lib/countries";

type Props = {
  user: { firstName: string; lastName: string; email: string; phone: string | null; locale: string };
  practitioner: {
    profession: string; rpps: string | null; country: string; licenseNumber: string | null; city: string | null; specialty: string | null; listed: boolean;
    rppsStatus: "none" | "pending" | "verified" | "rejected"; rppsNote: string | null;
  } | null;
};

export function ProfileForm({ user, practitioner }: Props) {
  const [state, action, pending] = useActionState(updateProfile, undefined);
  const [countryCode, setCountryCode] = useState(practitioner?.country ?? "FR");
  const rule = countryCode === "FR" ? null : licenseRule(countryCode);
  // Le numéro saisi n'est conservé que si le pays d'exercice n'a pas changé.
  const sameCountry = countryCode === practitioner?.country;
  return (
    <form action={action} className="card form">
      <h2>Informations personnelles</h2>
      <Notice state={state} />
      <div className="row">
        <label>Prénom<input name="firstName" maxLength={120} defaultValue={user.firstName} required /></label>
        <label>Nom<input name="lastName" maxLength={120} defaultValue={user.lastName} required /></label>
      </div>
      <div className="row">
        <label>Téléphone<input name="phone" type="tel" defaultValue={user.phone ?? ""} /></label>
        {/* Interface disponible en français uniquement pour l'instant : la préférence est conservée telle quelle. */}
        <input type="hidden" name="locale" value={user.locale} />
      </div>
      {practitioner && (
        <>
          <div className="row">
            <label>Profession
              <select name="profession" defaultValue={practitioner.profession}>
                {[...new Set([...PROFESSIONS, practitioner.profession])].map((p) => <option key={p}>{p}</option>)}
              </select>
            </label>
            <label>Pays d&apos;exercice
              <select name="country" value={countryCode} onChange={(e) => setCountryCode(e.target.value)}>
                {COUNTRIES.map((c) => <option key={c.code} value={c.code}>{c.name}</option>)}
              </select>
              <span className="hint">Si vous exercez aussi en France, choisissez la France et indiquez votre RPPS.</span>
            </label>
          </div>
          <div className="row">
            {rule ? (
              <label key={`lic-${countryCode}`}>{rule.label}<input name="licenseNumber" maxLength={120} defaultValue={sameCountry ? practitioner.licenseNumber ?? "" : ""} />
                <span className="hint">{rule.hint}</span>
                <IdStatus p={practitioner} show={sameCountry} />
              </label>
            ) : (
              <label key="rpps">N° RPPS<input name="rpps" inputMode="numeric" pattern="[0-9 ]{11,14}" title="11 chiffres" defaultValue={sameCountry ? practitioner.rpps ?? "" : ""} />
                <IdStatus p={practitioner} show={sameCountry} />
              </label>
            )}
          </div>
          <div className="row">
            <label>Ville d&apos;exercice<input name="city" defaultValue={practitioner.city ?? ""} /></label>
            <label>Spécialité / domaine<input name="specialty" defaultValue={practitioner.specialty ?? ""} /></label>
          </div>
        </>
      )}
      <button className="btn" disabled={pending}>{pending ? "Enregistrement…" : "Enregistrer"}</button>
    </form>
  );
}

/** État de la vérification de l'identifiant professionnel (RPPS ou identifiant étranger). */
function IdStatus({ p, show }: { p: NonNullable<Props["practitioner"]>; show: boolean }) {
  const status = show ? p.rppsStatus : "none";
  return (
    <span className="hint">
      {status === "verified" && "Vérifié par KolBase : badge « Identité vérifiée » affiché."}
      {status === "pending" && "En cours de vérification par KolBase."}
      {status === "rejected" && `Non validé${p.rppsNote ? ` : ${p.rppsNote}` : ""}. Corrigez le numéro pour une nouvelle vérification.`}
      {status === "none" && "Nécessaire pour être référencé comme expert ; vérifié par KolBase."}
    </span>
  );
}

export function PasswordForm({ email }: { email: string }) {
  const [state, action, pending] = useActionState(changePassword, undefined);
  return (
    <form action={action} className="card form">
      <h2>Identifiants de connexion</h2>
      <p className="muted">E-mail de connexion : <strong>{email}</strong></p>
      <Notice state={state} />
      <label>Mot de passe actuel<input name="current" type="password" autoComplete="current-password" required /></label>
      <div className="row">
        <label>Nouveau mot de passe<input name="next" type="password" autoComplete="new-password" minLength={10} required /></label>
        <label>Confirmation<input name="confirm" type="password" autoComplete="new-password" minLength={10} required /></label>
      </div>
      <button className="btn" disabled={pending}>{pending ? "Modification…" : "Changer le mot de passe"}</button>
    </form>
  );
}

export function ListingForm({ listed, eligible, hasRpps }: { listed: boolean; eligible: boolean; hasRpps: boolean }) {
  const [state, action, pending] = useActionState(setListed, undefined);
  if (!listed && !eligible)
    return (
      <section className="card">
        <h2>Référencement comme expert</h2>
        <p className="muted">Le référencement comme expert (KOL) est réservé aux chirurgiens-dentistes, orthodontistes, chirurgiens oraux et stomatologues. Votre compte vous permet de vous inscrire aux événements.</p>
      </section>
    );
  return (
    <form action={action} className={`card form ${listed ? "" : "highlight"}`}>
      <h2>{listed ? "Vous êtes référencé comme expert" : "Devenir expert référencé (KOL)"}</h2>
      <Notice state={state} />
      {listed ? (
        <p className="muted">Votre profil est visible dans l&apos;annuaire et sur le site public. Les organisations peuvent vous solliciter ; chaque collaboration fera l&apos;objet d&apos;une convention déclarée.</p>
      ) : (
        <ul className="muted">
          <li>Votre profil apparaît dans l&apos;annuaire des experts et sur le site public.</li>
          <li>Vous recevez des sollicitations et accédez aux opportunités.</li>
          <li>Toute rémunération ou avantage reçu sera conventionné et publié sur Transparence Santé.</li>
          {!hasRpps && <li><strong>Prérequis : renseignez votre numéro RPPS</strong> (Informations personnelles, plus bas).</li>}
        </ul>
      )}
      <input type="hidden" name="listed" value={listed ? "0" : "1"} />
      <button className={listed ? "btn ghost" : "btn"} disabled={pending}>
        {listed ? "Retirer mon référencement" : "Me référencer comme expert"}
      </button>
    </form>
  );
}

/** Adresse non confirmée : rappel et renvoi du lien. */
export function EmailVerificationNotice({ email }: { email: string }) {
  const [state, action, pending] = useActionState(resendVerification, undefined);
  return (
    <form action={action} className="notice warn">
      Confirmez votre adresse <strong>{email}</strong> pour recevoir les sollicitations, messages et rappels : un lien vous a été envoyé.{" "}
      {state?.ok || state?.error ? <span>{state.ok ?? state.error}</span> : <button className="link" disabled={pending}>Renvoyer le lien</button>}
    </form>
  );
}

export function NotificationsForm({ email }: { email: boolean }) {
  const [state, action, pending] = useActionState(updateNotifyPrefs, undefined);
  return (
    <form action={action} className="card form">
      <h2>Notifications</h2>
      <Notice state={state} />
      <label className="check">
        <input type="checkbox" name="email" value="1" defaultChecked={email} /> Recevoir par e-mail les sollicitations, réponses, messages, candidatures et devis
      </label>
      <p className="hint">Les e-mails de service (mot de passe, confirmation d&apos;adresse, invitations) sont toujours envoyés.</p>
      <button className="btn secondary" disabled={pending}>Enregistrer</button>
    </form>
  );
}

/** Mes données : export (portabilité) et suppression du compte (anonymisation). */
export function MyDataCard({ keep }: { keep: { conventions: number; hospitalities: number } }) {
  const [state, action, pending] = useActionState(deleteAccount, undefined);
  const kept = keep.conventions + keep.hospitalities > 0;
  return (
    <section className="card form">
      <h2>Mes données</h2>
      <p className="muted">Téléchargez l&apos;ensemble des données de votre compte (profil, publications, inscriptions, collaborations, messages) au format JSON.</p>
      <div className="actions"><a className="btn ghost" href="/compte/export">Télécharger mes données</a></div>
      <details>
        <summary>Supprimer mon compte</summary>
        <form action={action} className="stack-sm">
          <p className="muted">
            La suppression est définitive : vous ne pourrez plus vous connecter, votre fiche est retirée, vos publications, coordonnées, suivis et candidatures en
            attente sont effacés, vos inscriptions à venir annulées et vos sollicitations en attente déclinées.
            {kept
              ? ` Votre nom, votre profession, votre RPPS, votre ville et votre structure de facturation restent attachés à vos ${keep.conventions ? `${keep.conventions} convention(s)` : ""}${keep.conventions && keep.hospitalities ? " et " : ""}${keep.hospitalities ? `${keep.hospitalities} hospitalité(s)` : ""} : les organisations doivent les conserver (dispositif anti-cadeaux, Transparence Santé).`
              : " Aucune convention ni hospitalité n'est attachée à votre compte : votre nom est également effacé."}
          </p>
          <Notice state={state} />
          <label>Mot de passe<input name="password" type="password" autoComplete="current-password" required /></label>
          <label className="check"><input type="checkbox" name="confirm" value="1" required /> Je comprends que la suppression est définitive.</label>
          <button className="btn danger" disabled={pending}>{pending ? "Suppression…" : "Supprimer définitivement mon compte"}</button>
        </form>
      </details>
    </section>
  );
}
