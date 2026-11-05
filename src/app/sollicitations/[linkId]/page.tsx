import Link from "next/link";
import { notFound } from "next/navigation";
import { Building2, CalendarDays, Euro, Scale } from "lucide-react";
import { SiteHeader } from "@/components/SiteHeader";
import { PageHero } from "@/components/PageHero";
import { ExpertLinkPill, Pipeline, Thread } from "@/components/ProjectBits";
import { MessageForm, RespondForm } from "@/components/ProjectForms";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { collabType, expertLinkState, PROPOSAL_ORIGIN, unitCount } from "@/lib/projects";
import { withdrawProposal } from "@/lib/proposal-actions";
import { ConfirmButton } from "@/components/ConfirmButton";
import { orgIsPublic } from "@/lib/org-roles";
import { DocumentsPanel, ExpertSignatureBlock, MaterialsPanel } from "@/components/DossierSections";
import { fmtEur, intlLocale } from "@/lib/i18n";
import { getT } from "@/lib/i18n/server";

export async function generateMetadata() {
  const { t } = await getT();
  return { title: `${t("Sollicitation")} — KolBase` };
}

export default async function Page({ params }: { params: Promise<{ linkId: string }> }) {
  const { linkId } = await params;
  const user = await requireUser();
  const link = await db.projectExpert.findFirst({
    where: { id: linkId, practitioner: { userId: user.id } },
    include: {
      project: { include: { organization: true } },
      signature: true,
      // Convention signée déposée à la main (la plus récente).
      documents: { where: { kind: "CONVENTION_SIGNEE" }, select: { id: true }, orderBy: { createdAt: "desc" }, take: 1 },
      messages: { include: { author: { select: { firstName: true, lastName: true } } }, orderBy: { createdAt: "asc" } },
    },
  });
  if (!link) notFound();
  const p = link.project;
  const type = collabType(p.typeId);
  const state = expertLinkState(link, p);
  // Projet proposé par l'expert lui-même, en attente de la réponse de l'organisation (il peut le retirer).
  const proposal = p.origin === PROPOSAL_ORIGIN;
  const awaitingOrg = proposal && p.status === "ATT_IND";
  // Dossier abandonné par l'organisation (ou proposition déclinée, ou retirée) : plus rien à faire.
  const abandoned = state === "abandonne" || state === "refuse" || state === "retire";
  // Sollicitation restée sans réponse alors que le dossier a avancé : le recrutement est clos.
  const closed = state === "clos";
  const { t, locale } = await getT();
  const num = (n: number) => n.toLocaleString(intlLocale(locale));
  // Unité de prestation (« journée », « séance »…), traduite avec son pluriel.
  const unit = type?.unit ?? "unité";

  const engaged = link.status !== "ATT_EXPERTS" && link.status !== "DECLINE" && !abandoned;
  // Convention signée : électroniquement (Yousign) ou déposée signée dans Documents.
  const signedDocId = link.documents[0]?.id ?? null;
  const signedHref = link.signature?.status === "done" ? `/signatures/${link.id}` : signedDocId ? `/documents/${signedDocId}` : null;
  const lastMsg = link.messages.at(-1);
  // Ce qu'on attend de l'expert, selon l'étape.
  const next =
    state === "abandonne" ? t("Ce dossier a été abandonné par l'organisation.")
    : state === "refuse" ? t("L'organisation a décliné votre proposition.")
    : state === "retire" ? t("Vous avez retiré cette proposition.")
    : awaitingOrg ? t("Votre proposition attend la réponse de l'organisation : vous êtes prévenu par e-mail. Vous pouvez la retirer tant qu'elle n'a pas répondu.")
    : closed ? t("Le recrutement de ce dossier est clos : l'organisation doit vous solliciter de nouveau.")
    : state === "contre" ? t("Vous avez proposé d'autres honoraires : l'organisation peut les accepter ou vous renvoyer une proposition. Vous pouvez encore modifier votre réponse.")
    : link.status === "ATT_EXPERTS" ? t("Donnez votre réponse : accord de principe, autres honoraires ou refus.")
    : link.status === "DECLINE" ? t("Vous avez décliné cette sollicitation.")
    : p.status === "SIGNATURE" && signedHref ? t("Convention signée déposée : l'organisation confirme la signature du dossier.")
    : p.status === "SIGNATURE" && link.signature?.status !== "done" ? t("Signez la convention : électroniquement si une demande vous a été envoyée, sinon déposez-la signée dans Documents.")
    : ["ATT_EXPERTS", "ACCORD", "EN_VALID", "BLOQUE", "VALIDE", "ORDRE"].includes(p.status) ? t("L'organisation prépare le dossier (validation, démarches). Vous pouvez relire le projet de convention et soumettre vos supports.")
    : p.status === "SIGNE" ? t("Convention signée : la prestation peut avoir lieu.")
    : p.status === "TERMINE" ? t("Prestation réalisée. Merci !")
    : t("Échangez avec l'organisation si besoin.");

  return (
    <>
      <SiteHeader />
      <main className="stack">
        <p className="muted">{proposal ? <Link href="/propositions">{t("Mes propositions")}</Link> : <Link href="/sollicitations">{t("Mes sollicitations")}</Link>}</p>
        <PageHero
          eyebrow={`${p.organization.name} · ${type ? t(type.label) : p.typeId}${p.therapeuticArea ? ` · ${t(p.therapeuticArea)}` : ""}`}
          status={<ExpertLinkPill state={state} status={p.status === "ATT_IND" ? "ATT_IND" : link.status} />}
          title={p.title}
          lead={p.description}
          facts={[
            { icon: <CalendarDays size={13} />, label: t("Prestation"), value: unitCount(t, intlLocale(locale), link.days, unit) },
            // Montant précédent rappelé (« 1 500 € → 1 800 € HT ») ; contre-proposition en attente de l'organisation.
            { icon: <Euro size={13} />, label: proposal ? t("Honoraires souhaités") : t("Honoraires proposés"), value: link.feeCents != null ? t("{amount} HT", { amount: link.previousFeeCents != null ? `${fmtEur(locale, link.previousFeeCents)} → ${fmtEur(locale, link.feeCents)}` : fmtEur(locale, link.feeCents) }) : "—", sub: state === "contre" && link.desiredFeeCents != null ? t("votre proposition : {amount} HT", { amount: fmtEur(locale, link.desiredFeeCents) }) : undefined },
            ...(type ? [{ icon: <Scale size={13} />, label: t("Référence de marché"), value: t("{min} à {max} € HT", { min: num(type.fmv[0]), max: num(type.fmv[1]) }), sub: t("par {unit}", { unit: t(type.unit) }) }] : []),
            { icon: <Building2 size={13} />, label: t("Organisation"), value: p.organization.name, sub: p.organization.sector ? t(p.organization.sector) : undefined },
          ]}
        >
          {engaged && <Pipeline viewer="expert" status={link.status} />}
        </PageHero>

        <div className="page-grid">
          <div className="page-main">
            {link.status === "ATT_EXPERTS" && !abandoned && !closed && (
              <section className="card highlight"><h2>{t("Votre réponse")}</h2><RespondForm linkId={link.id} /></section>
            )}
            {engaged && <ExpertSignatureBlock linkId={link.id} signature={link.signature} email={user.email} projectStatus={p.status} signedDocId={signedDocId} />}
            {engaged && p.status !== "ATT_IND" && <MaterialsPanel orgId={p.organizationId} projectId={p.id} canSubmit canReview={false} />}
            {engaged && <DocumentsPanel projectId={p.id} linkId={link.id} canUpload openUpload={p.status === "SIGNATURE"} />}
            <section className="card">
              <div className="exchanges-head">
                <h2 style={{ margin: 0 }}>{t("Échanges avec {org}", { org: p.organization.name })}</h2>
                {lastMsg && lastMsg.authorId !== user.id && !abandoned && !closed && <span className="pill electric">{t("À vous de répondre")}</span>}
              </div>
              <Thread messages={link.messages} meId={user.id} />
              {!abandoned && link.status !== "DECLINE" && <MessageForm linkId={link.id} />}
            </section>
          </div>
          <aside className="page-aside">
            <section className={`card next-step`}>
              <span className="eyebrow-sm">{t("Prochaine étape")}</span>
              <p className="next-hint">{next}</p>
              {state === "abandonne" && p.abandonNote && <p className="text-sm">{t("Motif : {note}", { note: p.abandonNote })}</p>}
              {awaitingOrg && (
                <form action={withdrawProposal}>
                  <input type="hidden" name="linkId" value={link.id} />
                  <ConfirmButton className="btn ghost small" confirm={t("retirer la proposition")} summary={t("{org} est prévenue, le dossier est clos.", { org: p.organization.name })} localized>
                    {t("Retirer ma proposition")}
                  </ConfirmButton>
                </form>
              )}
              {engaged && !awaitingOrg && (
                <div className="transitions-stack">
                  {signedHref && <a className="btn secondary" href={signedHref}>{t("Convention signée (PDF)")}</a>}
                  <a className="btn ghost" href={`/sollicitations/${link.id}/convention`} target="_blank" rel="noreferrer">{t("Projet de convention (PDF)")}</a>
                </div>
              )}
            </section>
            <section className="card stack-sm">
              <h2 className="section-title">{p.organization.name}</h2>
              {p.organization.about && <p className="text-sm clamp-4">{p.organization.about}</p>}
              {p.organization.policy && <p className="text-xs muted">{t("Politique de collaboration")} : {p.organization.policy}</p>}
              {orgIsPublic(p.organization) && <Link className="link" href={`/structures/${p.organizationId}`}>{t("Voir la page de l'organisation")}</Link>}
            </section>
          </aside>
        </div>
      </main>
    </>
  );
}
