import Link from "next/link";
import { redirect } from "next/navigation";
import { CheckCircle2, Globe2, Palette } from "lucide-react";
import { PageHead, SectionHead } from "@/components/UI";
import { SiteHeader } from "@/components/SiteHeader";
import { TableWrap } from "@/components/TableWrap";
import { ConfirmButton } from "@/components/ConfirmButton";
import { BrandDomainForm, BrandForm } from "@/components/BrandForms";
import { requireMembership } from "@/lib/orgs";
import { addonGate } from "@/lib/billing";
import { db } from "@/lib/db";
import { logoSrc } from "@/lib/logos";
import { brandDomainTarget } from "@/lib/brand";
import { removeBrandDomain } from "@/lib/brand-actions";
import { getT } from "@/lib/i18n/server";
import { fmtDate } from "@/lib/i18n";

export async function generateMetadata() {
  const { t } = await getT();
  return { title: `${t("Marque et nom de domaine")} — KolBase` };
}

/**
 * KolBase Business (option de l'abonnement) : KolBase servi à la marque de l'organisation — nom affiché, logo, couleur —
 * sur son propre nom de domaine. L'habillage ne change aucun droit d'accès.
 */
export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { t, locale } = await getT();
  const { id } = await params;
  const { org } = await requireMembership(id, ["ADMIN"]);
  const gate = await addonGate(id, "business");
  if (gate) redirect(gate);
  const brand = await db.orgBrand.findUnique({ where: { organizationId: id } });
  const logo = logoSrc(org);
  const target = brandDomainTarget();
  return (
    <>
      <SiteHeader />
      <main className="narrow stack">
        <p className="muted"><Link href={`/organisations/${id}/membres?onglet=organisation`}>{t("Membres et réglages")}</Link> / {t("Marque et nom de domaine")}</p>
        <PageHead title={t("Marque et nom de domaine")} desc={t("KolBase Business : vos équipes utilisent KolBase à votre adresse, à votre nom, avec votre logo et votre couleur.")} />

        <section className="card stack-sm">
          <SectionHead icon={Palette} title={t("Votre marque")} desc={t("Affichée à la place de celle de KolBase quand le site est ouvert sur votre nom de domaine.")} />
          <div className="actions">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            {logo ? <img src={logo} alt={t("Logo de {name}", { name: org.name })} style={{ height: 40, width: "auto" }} /> : <span className="muted">{t("Aucun logo déposé : votre nom s'affiche à sa place.")}</span>}
            <Link className="btn ghost small" href={`/organisations/${id}/membres?onglet=organisation`}>{logo ? t("Changer le logo") : t("Déposer un logo")}</Link>
          </div>
          <BrandForm orgId={id} orgName={org.name} displayName={brand?.displayName ?? ""} color={brand?.color ?? null} />
        </section>

        <section className="card stack-sm" id="domaine">
          <div className="actions spread">
            <h2><Globe2 size={18} aria-hidden />{" "}{t("Votre nom de domaine")}</h2>
            {brand?.domain && <span className={`pill ${brand.domainStatus === "active" ? "ok" : "wait"}`}>{brand.domainStatus === "active" ? t("Actif") : brand.domainStatus === "retire" ? t("Retrait en cours") : t("En attente d'activation")}</span>}
          </div>
          {brand?.domain && brand.domainStatus === "retire" ? (
            <p className="notice">{t("{domain} n'affiche plus votre marque. L'équipe KolBase le détache du service ; vous pourrez ensuite demander un autre nom de domaine. Pensez à supprimer l'enregistrement DNS.", { domain: brand.domain })}</p>
          ) : brand?.domain ? (
            <>
              {brand.domainStatus === "active"
                ? <p className="notice ok"><CheckCircle2 size={15} />{" "}{t("KolBase est servi à votre marque sur")}{" "}<a href={`https://${brand.domain}`} target="_blank" rel="noopener noreferrer">{brand.domain}</a>{brand.domainActivatedAt ? ` ${t("depuis le {date}", { date: fmtDate(locale, brand.domainActivatedAt) })}` : ""}.</p>
                : <p className="notice">{t("Demande enregistrée pour {domain}. Créez l'enregistrement DNS ci-dessous chez le gestionnaire de votre domaine : l'équipe KolBase rattache ensuite le domaine, vérifie son certificat et l'active.", { domain: brand.domain })}</p>}
              <TableWrap label={t("Enregistrement DNS à créer")}>
                <table className="table">
                  <thead><tr><th>{t("Type")}</th><th>{t("Nom")}</th><th>{t("Valeur")}</th></tr></thead>
                  <tbody><tr><td data-label={t("Type")}>CNAME</td><td data-label={t("Nom")}><code>{brand.domain}</code></td><td data-label={t("Valeur")}><code>{target}</code></td></tr></tbody>
                </table>
              </TableWrap>
              <form action={removeBrandDomain}>
                <input type="hidden" name="orgId" value={id} />
                <ConfirmButton className="btn ghost small" confirm={t("retirer le nom de domaine")} summary={t("{domain} cesse aussitôt d'afficher votre marque et les sessions qui y sont ouvertes sont fermées.", { domain: brand.domain })} localized>{t("Retirer le nom de domaine")}</ConfirmButton>
              </form>
            </>
          ) : (
            <>
              <p className="muted">{t("Choisissez un sous-domaine d'un domaine qui vous appartient, par exemple kol.votre-domaine.com.")}</p>
              <BrandDomainForm orgId={id} />
            </>
          )}
        </section>

        <section className="card stack-sm">
          <SectionHead icon={CheckCircle2} title={t("Ce que comprend KolBase Business")} />
          <ul className="plain check-list">
            <li><CheckCircle2 size={15} /> <span>{t("Sur votre nom de domaine : votre nom, votre logo et votre couleur dans l'en-tête, la barre latérale et le pied de page.")}</span></li>
            <li><CheckCircle2 size={15} /> <span>{t("L'accueil de votre adresse est votre page : votre espace pour un membre connecté, votre page publique pour vos experts et vos visiteurs.")}</span></li>
            <li><CheckCircle2 size={15} /> <span>{t("Seuls les membres de votre organisation se connectent sur votre adresse, et n'y voient que votre espace. Vos experts gardent leur compte et leur espace sur kolbase.io.")}</span></li>
            <li><CheckCircle2 size={15} /> <span>{t("Votre adresse n'est pas indexée par les moteurs de recherche : vos pages publiques restent référencées sur KolBase.")}</span></li>
            <li><CheckCircle2 size={15} /> <span>{t("KolBase reste l'éditeur du service : mentions légales, conditions et confidentialité sont les siennes, et les e-mails partent toujours de KolBase, avec des liens vers kolbase.io.")}</span></li>
          </ul>
        </section>
      </main>
    </>
  );
}
