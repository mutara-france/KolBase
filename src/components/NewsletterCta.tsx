import Link from "next/link";
import { Mail } from "lucide-react";
import { getCurrentUser } from "@/lib/auth";
import { answerNewsletter } from "@/lib/auth-actions";
import { subscribed } from "@/lib/newsletter";
import { getT } from "@/lib/i18n/server";
import { ResendVerificationLink } from "@/components/AccountForms";

/** Encart d'abonnement à la lettre d'information (pages publiques des actualités). */
export async function NewsletterCta({ next = "/actualites" }: { next?: string }) {
  const [user, { t }] = await Promise.all([getCurrentUser(), getT()]);
  // La lettre part aux seuls praticiens dont l'adresse est confirmée : l'abonné l'apprend ici.
  if (user && subscribed(user) && user.practitioner && !user.emailVerifiedAt) {
    return (
      <div className="hint newsletter-done">
        <Mail size={15} aria-hidden /> {t("Vous êtes abonné à la lettre d'information de KolBase : l'envoi commencera après la confirmation de votre adresse {email}.", { email: user.email })}{" "}
        <ResendVerificationLink />
      </div>
    );
  }
  if (user && subscribed(user) && user.practitioner) {
    return <p className="hint newsletter-done"><Mail size={15} aria-hidden /> {t("Vous êtes abonné à la lettre d'information de KolBase.")} <Link href="/compte">{t("Gérer")}</Link></p>;
  }
  if (user && !user.practitioner) {
    return <p className="hint newsletter-done"><Mail size={15} aria-hidden /> {t("La lettre d'information de KolBase est adressée aux praticiens inscrits.")}</p>;
  }
  return (
    <section className="card newsletter-cta" aria-labelledby="lettre-cta">
      <Mail size={28} strokeWidth={1.6} aria-hidden />
      <div>
        <h2 id="lettre-cta">{t("La lettre d'information de KolBase")}</h2>
        <p className="muted">{t("Les événements scientifiques à venir et les nouveautés de la plateforme, deux envois par mois au plus. Désinscription en un clic depuis chaque envoi.")}</p>
      </div>
      {user ? (
        <form action={answerNewsletter}>
          <input type="hidden" name="source" value="actualites" />
          <button className="btn" name="choice" value="oui">{t("Je m'abonne")}</button>
        </form>
      ) : (
        <Link className="btn" href={`/inscription?next=${encodeURIComponent(next)}`}>{t("Créer un compte gratuit")}</Link>
      )}
    </section>
  );
}
