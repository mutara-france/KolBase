"use client";

import Link from "next/link";
import { useActionState } from "react";
import { requestPasswordReset, resetPassword, signIn, signUp, type FormState } from "@/lib/auth-actions";
import { PROFESSIONS } from "@/lib/professions";
import { COUNTRIES } from "@/lib/countries";
import { useT } from "@/components/I18nProvider";

/** Lien entre connexion et création de compte : la page d'origine (`next`) suit. */
const withNext = (path: string, next?: string) => (next ? `${path}?next=${encodeURIComponent(next)}` : path);

export function Notice({ state }: { state: FormState }) {
  if (state?.error) return <p className="notice error" role="alert">{state.error}</p>;
  if (state?.ok) return <p className="notice ok" role="status">{state.ok}</p>;
  return null;
}

export function SignInForm({ next }: { next?: string }) {
  const [state, action, pending] = useActionState(signIn, undefined);
  const t = useT();
  return (
    <form action={action} className="card form">
      <h1>{t("Connexion")}</h1>
      <Notice state={state} />
      <input type="hidden" name="next" value={next ?? ""} />
      <label>{t("E-mail")}<input name="email" type="email" autoComplete="email" required /></label>
      <label>{t("Mot de passe")}<input name="password" type="password" autoComplete="current-password" required /></label>
      <button className="btn" disabled={pending}>{pending ? t("Connexion…") : t("Se connecter")}</button>
      <p className="muted"><Link href="/mot-de-passe-oublie">{t("Mot de passe oublié ?")}</Link></p>
      <p className="muted">{t("Pas encore de compte ?")} <Link href={withNext("/inscription", next)}>{t("Créer un compte")}</Link></p>
    </form>
  );
}


export function SignUpForm({ next }: { next?: string }) {
  const [state, action, pending] = useActionState(signUp, undefined);
  const t = useT();
  return (
    <form action={action} className="card form">
      <h1>{t("Créer un compte")}</h1>
      <p className="muted">{t("Un seul compte pour vous inscrire aux événements et, si vous le souhaitez, vous référencer comme expert.")}</p>
      <Notice state={state} />
      <input type="hidden" name="next" value={next ?? ""} />
      <div className="row">
        <label>{t("Prénom")}<input name="firstName" maxLength={120} autoComplete="given-name" required /></label>
        <label>{t("Nom")}<input name="lastName" maxLength={120} autoComplete="family-name" required /></label>
      </div>
      <label>{t("E-mail professionnel")}<input name="email" type="email" autoComplete="email" required /></label>
      <label>{t("Profession")}
        <select name="profession" defaultValue="Chirurgien-dentiste">
          {PROFESSIONS.map((p) => <option key={p} value={p}>{t(p)}</option>)}
          <option value="">{t("Je représente une organisation")}</option>
        </select>
      </label>
      <label>{t("Pays d'exercice")}
        <select name="country" defaultValue="FR">
          {COUNTRIES.map((c) => <option key={c.code} value={c.code}>{t(c.name)}</option>)}
        </select>
        <span className="hint">{t("Hors de France, vous vous référencerez avec l'identifiant professionnel de votre pays.")}</span>
      </label>
      <label>{t("Mot de passe")}<input name="password" type="password" autoComplete="new-password" minLength={10} required />
        <span className="hint">{t("10 caractères minimum, avec au moins une lettre et un chiffre.")}</span>
      </label>
      <label className="check"><input type="checkbox" name="newsletter" value="1" /> {t("Recevoir la lettre d'information de KolBase : événements scientifiques et nouveautés (deux envois par mois au plus, désinscription en un clic)")}</label>
      <label className="check"><input type="checkbox" name="cgu" required /> {t("J'accepte les")} <Link href="/cgu" target="_blank">{t("conditions d'utilisation")}</Link> {t("et la")} <Link href="/confidentialite" target="_blank">{t("politique de confidentialité")}</Link>.</label>
      <button className="btn" disabled={pending}>{pending ? t("Création…") : t("Créer mon compte")}</button>
      <p className="muted">{t("Déjà inscrit ?")} <Link href={withNext("/connexion", next)}>{t("Se connecter")}</Link></p>
    </form>
  );
}

export function ForgotPasswordForm() {
  const [state, action, pending] = useActionState(requestPasswordReset, undefined);
  const t = useT();
  return (
    <form action={action} className="card form">
      <h1>{t("Mot de passe oublié")}</h1>
      <p className="muted">{t("Indiquez l'adresse de votre compte : vous recevrez un lien pour choisir un nouveau mot de passe, valable une heure.")}</p>
      <Notice state={state} />
      {!state?.ok && (
        <>
          <label>{t("E-mail")}<input name="email" type="email" autoComplete="email" required /></label>
          <button className="btn" disabled={pending}>{pending ? t("Envoi…") : t("Recevoir le lien")}</button>
        </>
      )}
      <p className="muted"><Link href="/connexion">{t("Retour à la connexion")}</Link></p>
    </form>
  );
}

export function ResetPasswordForm({ token, email }: { token: string; email: string }) {
  const [state, action, pending] = useActionState(resetPassword, undefined);
  const t = useT();
  return (
    <form action={action} className="card form">
      <h1>{t("Nouveau mot de passe")}</h1>
      <p className="muted">{t("Compte :")} <strong>{email}</strong>. {t("Vos autres sessions seront fermées.")}</p>
      <Notice state={state} />
      <input type="hidden" name="token" value={token} />
      <label>{t("Nouveau mot de passe")}<input name="password" type="password" autoComplete="new-password" minLength={10} required /></label>
      <label>{t("Confirmation")}<input name="confirm" type="password" autoComplete="new-password" minLength={10} required /></label>
      <p className="hint">{t("10 caractères au moins, dont une lettre et un chiffre.")}</p>
      <button className="btn" disabled={pending}>{pending ? t("Enregistrement…") : t("Enregistrer et me connecter")}</button>
    </form>
  );
}
