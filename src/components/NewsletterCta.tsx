import Link from "next/link";
import { Mail } from "lucide-react";
import { getCurrentUser } from "@/lib/auth";
import { answerNewsletter } from "@/lib/auth-actions";
import { subscribed } from "@/lib/newsletter";
import { getT } from "@/lib/i18n/server";

/** Encart d'abonnement à la lettre d'information (pages publiques des actualités). */
export async function NewsletterCta({ next = "/actualites" }: { next?: string }) {
  const [user, { t }] = await Promise.all([getCurrentUser(), getT()]);
  if (user && subscribed(user)) {
    return <p className="hint newsletter-done"><Mail size={15} aria-hidden /> {t("Vous êtes abonné à la lettre d'information de KolBase.")} <Link href="/compte">{t("Gérer")}</Link></p>;
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
