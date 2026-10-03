"use client";

import { useActionState } from "react";
import { changePassword, setListed, updateProfile } from "@/lib/auth-actions";
import { Notice } from "@/components/AuthForms";

type Props = {
  user: { firstName: string; lastName: string; email: string; phone: string | null; locale: string };
  practitioner: { profession: string; rpps: string | null; city: string | null; specialty: string | null; listed: boolean } | null;
};

export function ProfileForm({ user, practitioner }: Props) {
  const [state, action, pending] = useActionState(updateProfile, undefined);
  return (
    <form action={action} className="card form">
      <h2>Informations personnelles</h2>
      <Notice state={state} />
      <div className="row">
        <label>Prénom<input name="firstName" defaultValue={user.firstName} required /></label>
        <label>Nom<input name="lastName" defaultValue={user.lastName} required /></label>
      </div>
      <div className="row">
        <label>Téléphone<input name="phone" type="tel" defaultValue={user.phone ?? ""} /></label>
        <label>Langue
          <select name="locale" defaultValue={user.locale}><option value="fr">Français</option><option value="en">English</option></select>
        </label>
      </div>
      {practitioner && (
        <>
          <div className="row">
            <label>Profession<input name="profession" defaultValue={practitioner.profession} /></label>
            <label>N° RPPS<input name="rpps" inputMode="numeric" pattern="[0-9]{11}" title="11 chiffres" defaultValue={practitioner.rpps ?? ""} /></label>
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

export function ListingForm({ listed }: { listed: boolean }) {
  const [state, action, pending] = useActionState(setListed, undefined);
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
        </ul>
      )}
      <input type="hidden" name="listed" value={listed ? "0" : "1"} />
      <button className={listed ? "btn ghost" : "btn"} disabled={pending}>
        {listed ? "Retirer mon référencement" : "Me référencer comme expert"}
      </button>
    </form>
  );
}
