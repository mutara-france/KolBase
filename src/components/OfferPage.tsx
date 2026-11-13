import Link from "next/link";
import type { LucideIcon } from "lucide-react";
import { ArrowRight, CheckCircle2 } from "lucide-react";
import { SiteHeader } from "@/components/SiteHeader";
import { getCurrentUser } from "@/lib/auth";
import { addonFree, addonHref, addonPrice, ADDONS, formatPrice, PLANS, type Addon } from "@/lib/billing-plans";
import { LEGAL } from "@/lib/legal";
import { getT } from "@/lib/i18n/server";

export type OfferCopy = {
  title: string; accent: string; lede: string;
  /** Selon que l'option est en vente ou en accès libre (mise au point) : étiquette, première étape, première remarque. */
  paid: { pill: string; step: string; note: string };
  free: { pill: string; note: string };
  /** Page de l'option dans l'espace d'une organisation (/organisations/<id>/…). */
  path: string;
  /** Ce que l'option apporte : six cartes au plus. */
  features: { icon: LucideIcon; title: string; text: string }[];
  /** Mise en route, dans l'ordre (après l'ajout de l'option, quand elle est en vente). */
  steps: string[];
  /** Ce qu'il faut savoir avant de souscrire : limites dites simplement. */
  notes: string[];
};

/**
 * Page de présentation d'une option de l'abonnement organisation (KolBase Intelligence, KolBase Business) : publique,
 * atteinte depuis le pied de page. Les prix viennent de `ADDONS` (une seule source avec la page Abonnement et les
 * conditions de vente). Le bouton mène un administrateur d'une organisation concernée à sa page Abonnement, ouverte sur
 * l'option ; les autres visiteurs à l'inscription de leur organisation. Option en accès libre (`free`) : ni prix ni
 * achat, le bouton ouvre directement la page de l'option dans l'espace de l'organisation.
 */
export async function OfferPage({ addon, copy }: { addon: Addon; copy: OfferCopy }) {
  const [{ t, locale }, user] = await Promise.all([getT(), getCurrentUser()]);
  const option = ADDONS[addon];
  const mine = user?.memberships.find((m) => m.role === "ADMIN" && (option.kinds as readonly string[]).includes(m.organization.kind));
  const free = addonFree(addon);
  const cta = mine ? (free ? { href: `/organisations/${mine.organizationId}/${copy.path}`, label: t("Ouvrir dans mon espace") } : { href: addonHref(mine.organizationId, addon), label: t("Ajouter l'option à mon abonnement") }) : user ? null : { href: "/inscription?profil=organisation", label: t("Inscrire mon organisation") };
  const contact = LEGAL.contactEmail ?? "contact@kolbase.io";
  return (
    <>
      <SiteHeader />
      <main className="landing home offer">
        <section className="home-hero" aria-labelledby="offre-titre">
          <div className="home-wrap home-hero-inner">
            <div className="home-hero-text">
              <p className="home-pill">{t(free ? copy.free.pill : copy.paid.pill)}</p>
              <h1 id="offre-titre" className="home-title">{t(copy.title)} <em>{t(copy.accent)}</em></h1>
              <p className="home-lede">{t(copy.lede)}</p>
              {free
                ? <p className="offer-price"><strong>{t("En accès libre pendant sa mise au point.")}</strong> {t("Rien à activer, rien à payer pour l'instant.")}</p>
                : <p className="offer-price"><strong>{formatPrice(addonPrice(addon, "month"), "month", t, locale)}</strong> {t("en plus de l'abonnement organisation ({price}). Formule annuelle : dix mois payés pour douze.", { price: formatPrice(PLANS.organisation.cents, "month", t, locale) })}</p>}
              <div className="actions">
                {cta && <Link className="btn white" href={cta.href}>{cta.label} <ArrowRight size={16} /></Link>}
                <a className="btn ghost on-dark" href={`mailto:${contact}?subject=${encodeURIComponent(option.label)}`}>{t("Demander une démonstration")}</a>
              </div>
            </div>
          </div>
        </section>

        <section className="home-section" aria-labelledby="offre-apports">
          <div className="home-wrap">
            <div className="home-head"><div><span className="kicker">{option.label}</span><h2 id="offre-apports">{t("Ce que vous y gagnez")}</h2></div></div>
            <div className="offer-grid">
              {copy.features.map((f) => (
                <article key={f.title} className="offer-card">
                  <span className="offer-icon" aria-hidden><f.icon size={22} /></span>
                  <h3>{t(f.title)}</h3>
                  <p>{t(f.text)}</p>
                </article>
              ))}
            </div>
          </div>
        </section>

        <section className="home-section tinted" aria-labelledby="offre-etapes">
          <div className="home-wrap offer-two">
            <div>
              <div className="home-head"><div><span className="kicker">{t("Mise en route")}</span><h2 id="offre-etapes">{t("En service le jour même")}</h2></div></div>
              <ol className="offer-steps">{[...(free ? [] : [copy.paid.step]), ...copy.steps].map((s) => <li key={s}>{t(s)}</li>)}</ol>
            </div>
            <div>
              <div className="home-head"><div><span className="kicker">{t("À savoir")}</span><h2>{t("Dit simplement")}</h2></div></div>
              <ul className="plain check-list">{[free ? copy.free.note : copy.paid.note, ...copy.notes].map((n) => <li key={n}><CheckCircle2 size={16} aria-hidden /> <span>{t(n)}</span></li>)}</ul>
              {!free && <p className="muted text-sm">{t("Prix, facturation et résiliation :")} <Link href="/conditions-de-vente">{t("Conditions de vente")}</Link>.</p>}
            </div>
          </div>
        </section>
      </main>
    </>
  );
}
