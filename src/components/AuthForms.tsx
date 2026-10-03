"use client";

import Link from "next/link";
import { useActionState } from "react";
import { signIn, signUp, type FormState } from "@/lib/auth-actions";

export function Notice({ state }: { state: FormState }) {
  if (state?.error) return <p className="notice error" role="alert">{state.error}</p>;
  if (state?.ok) return <p className="notice ok" role="status">{state.ok}</p>;
  return null;
}

export function SignInForm({ next }: { next?: string }) {
  const [state, action, pending] = useActionState(signIn, undefined);
  return (
    <form action={action} className="card form">
      <h1>Connexion</h1>
      <Notice state={state} />
      <input type="hidden" name="next" value={next ?? ""} />
      <label>E-mail<input name="email" type="email" autoComplete="email" required /></label>
      <label>Mot de passe<input name="password" type="password" autoComplete="current-password" required /></label>
      <button className="btn" disabled={pending}>{pending ? "Connexion…" : "Se connecter"}</button>
      <p className="muted">Pas encore de compte ? <Link href="/inscription">Créer un compte</Link></p>
    </form>
  );
}

const PROFESSIONS = ["Chirurgien-dentiste", "Chirurgien-dentiste spécialiste ODF", "Chirurgien oral", "Médecin stomatologue", "Assistant(e) dentaire", "Prothésiste dentaire", "Étudiant(e) en odontologie"];

export function SignUpForm({ next }: { next?: string }) {
  const [state, action, pending] = useActionState(signUp, undefined);
  return (
    <form action={action} className="card form">
      <h1>Créer un compte</h1>
      <p className="muted">Un seul compte pour vous inscrire aux événements et, si vous le souhaitez, vous référencer comme expert.</p>
      <Notice state={state} />
      <input type="hidden" name="next" value={next ?? ""} />
      <div className="row">
        <label>Prénom<input name="firstName" autoComplete="given-name" required /></label>
        <label>Nom<input name="lastName" autoComplete="family-name" required /></label>
      </div>
      <label>E-mail professionnel<input name="email" type="email" autoComplete="email" required /></label>
      <label>Profession
        <select name="profession" defaultValue="Chirurgien-dentiste">
          {PROFESSIONS.map((p) => <option key={p}>{p}</option>)}
          <option value="">Je représente une organisation</option>
        </select>
      </label>
      <label>Mot de passe<input name="password" type="password" autoComplete="new-password" minLength={10} required />
        <span className="hint">10 caractères minimum, avec au moins une lettre et un chiffre.</span>
      </label>
      <label className="check"><input type="checkbox" name="cgu" required /> J&apos;accepte les conditions d&apos;utilisation et la politique de confidentialité.</label>
      <button className="btn" disabled={pending}>{pending ? "Création…" : "Créer mon compte"}</button>
      <p className="muted">Déjà inscrit ? <Link href="/connexion">Se connecter</Link></p>
    </form>
  );
}
