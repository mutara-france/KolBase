import Link from "next/link";
import { notFound } from "next/navigation";
import { Clock, Briefcase, Building2, CalendarDays, Euro, FileSignature, FileText, MapPin, MessagesSquare, Reply, Scale } from "lucide-react";
import { SectionHead } from "@/components/UI";
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
import { fmtDateTime, fmtEur, intlLocale } from "@/lib/i18n";
import { DossierTabs, type DossierTab } from "@/components/DossierTabs";
import { FORMAT_LABEL, formatDuration } from "@/lib/events";
import { getT } from "@/lib/i18n/server";
import { fmtHours, hoursDetail, hoursOf } from "@/lib/fees";

export async function generateMetadata() {
  const { t } = await getT();
  return { title: `${t("Sollicitation")} — KolBase` };
}

export default async function Page({ params, searchParams }: { params: Promise<{ linkId: string }>; searchParams: Promise<{ onglet?: string }> }) {
  const { linkId } = await params;
  const { onglet } = await searchParams;
  const user = await requireUser();
  const link = await db.projectExpert.findFirst({
    where: { id: linkId, practitioner: { userId: user.id } },
    include: {
      project: {
        include: {
          organization: true,
          // Événement de la collaboration : rattaché au dossier, ou celui de l'opportunité à laquelle l'expert a candidaté.
          events: { where: { cancelledAt: null }, orderBy: { startsAt: "asc" } },
        },
      },
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

  // ─── Onglets : mission, messagerie, documents et convention, événement ───────
  const fromCall = await db.application.findFirst({ where: { projectId: p.id }, select: { openCall: { select: { event: true } } } });
  const callEvent = fromCall?.openCall.event;
  const events = callEvent && !callEvent.cancelledAt && !p.events.some((x) => x.id === callEvent.id) ? [...p.events, callEvent] : p.events;
  const toAnswer = !!lastMsg && lastMsg.authorId !== user.id && !abandoned && !closed;
  const toSign = engaged && p.status === "SIGNATURE" && !signedHref;
  // Agent public (France) : son autorisation de cumul est attendue avant la déclaration ou la demande à l'Ordre.
  const cumulDue = engaged && ["ACCORD", "EN_VALID", "BLOQUE", "VALIDE"].includes(p.status) && (await db.practitionerProfile.count({ where: { userId: user.id, publicAgent: true, country: "FR" } })) > 0
    && (await db.document.count({ where: { projectExpertId: link.id, kind: "AUTORISATION_CUMUL" } })) === 0;
  const tabs: DossierTab[] = [
    { key: "mission", label: t("Mission"), icon: Briefcase, alert: link.status === "ATT_EXPERTS" && !abandoned && !closed },
    { key: "evenement", label: t("Événement"), icon: CalendarDays, count: events.length > 1 ? events.length : undefined, disabled: events.length ? undefined : t("Aucun événement rattaché") },
    { key: "documents", label: t("Documents et convention"), icon: FileText, alert: toSign || cumulDue, disabled: engaged ? undefined : t("Après votre accord de principe") },
    { key: "messagerie", label: t("Messagerie"), icon: MessagesSquare, count: link.messages.length || undefined, alert: toAnswer },
  ];
  const active = tabs.find((tb) => tb.key === onglet && !tb.disabled)?.key ?? "mission";
  const href = (k: string) => (k === "mission" ? `/sollicitations/${link.id}` : `/sollicitations/${link.id}?onglet=${k}`);

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
            // Volume horaire proposé : préparation, intervention, déplacement, et taux horaire qui en découle.
            ...(hoursOf(link) != null ? [{ icon: <Clock size={13} />, label: t("Volume horaire"), value: fmtHours(hoursOf(link)!, intlLocale(locale)), sub: `${hoursDetail(link, t, intlLocale(locale))} · ${t("{rate} / h", { rate: fmtEur(locale, Math.round((link.feeCents ?? 0) / hoursOf(link)!)) })}` }] : []),
            ...(type ? [{ icon: <Scale size={13} />, label: t("Référence de marché"), value: t("{min} à {max} € HT", { min: num(type.fmv[0]), max: num(type.fmv[1]) }), sub: t("par {unit}", { unit: t(type.unit) }) }] : []),
            { icon: <Building2 size={13} />, label: t("Organisation"), value: p.organization.name, sub: p.organization.sector ? t(p.organization.sector) : undefined },
          ]}
        >
          {engaged && <Pipeline viewer="expert" status={link.status} />}
        </PageHero>

        <DossierTabs tabs={tabs} active={active} href={href} label={t("Rubriques de la collaboration")} />

        {active === "mission" && (
          <div className="page-grid">
            <div className="page-main">
              {link.status === "ATT_EXPERTS" && !abandoned && !closed && (
                <section className="card highlight" aria-labelledby="reponse-titre">
                  <SectionHead icon={Reply} id="reponse-titre" title={t("Votre réponse")} desc={t("Accord de principe, refus, ou d'autres honoraires : {org} est prévenue par e-mail.", { org: p.organization.name })} />
                  <RespondForm linkId={link.id} />
                </section>
              )}
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
                  <Link className={toSign ? "btn" : "btn ghost"} href={href("documents")}>{signedHref ? t("Convention signée") : t("Voir la convention")}</Link>
                </div>
              )}
            </section>
              {toAnswer && <p className="notice"><Link href={href("messagerie")}>{t("{org} vous a écrit : répondre dans la messagerie", { org: p.organization.name })}</Link></p>}
            </div>
            <aside className="page-aside">
            <section className="card stack-sm" aria-labelledby="organisation-titre">
              <SectionHead icon={Building2} id="organisation-titre" title={p.organization.name} desc={p.organization.sector ? t(p.organization.sector) : undefined} />
              {p.organization.about && <p className="text-sm clamp-4">{p.organization.about}</p>}
              {p.organization.policy && <p className="text-xs muted">{t("Politique de collaboration")} : {p.organization.policy}</p>}
              {orgIsPublic(p.organization) && <Link className="link" href={`/structures/${p.organizationId}`}>{t("Voir la page de l'organisation")}</Link>}
            </section>
            </aside>
          </div>
        )}

        {active === "messagerie" && (
          <section className="card messenger-solo">
            <div className="messenger-head">
              <div><h2>{t("Échanges avec {org}", { org: p.organization.name })}</h2></div>
              {toAnswer && <span className="pill electric">{t("À vous de répondre")}</span>}
            </div>
            <Thread messages={link.messages} meId={user.id} />
            {!abandoned && link.status !== "DECLINE" && <MessageForm linkId={link.id} />}
          </section>
        )}

        {active === "documents" && (
          <div className="stack">
            <ExpertSignatureBlock linkId={link.id} signature={link.signature} email={user.email} projectStatus={p.status} signedDocId={signedDocId} />
            <section className="card stack-sm" aria-labelledby="convention-titre">
              <SectionHead icon={FileSignature} id="convention-titre" title={t("Convention")} desc={signedHref ? t("Signée par les deux parties.") : t("Le projet de convention, tel que l'organisation vous le propose.")} tone={signedHref ? "ok" : "brand"} />
              <div className="actions">
                {signedHref && <a className="btn secondary" href={signedHref}>{t("Convention signée (PDF)")}</a>}
                <a className="btn ghost" href={`/sollicitations/${link.id}/convention`} target="_blank" rel="noreferrer">{t("Projet de convention (PDF)")}</a>
              </div>
            </section>
            <DocumentsPanel projectId={p.id} linkId={link.id} canUpload openUpload={p.status === "SIGNATURE"} />
            {p.status !== "ATT_IND" && <MaterialsPanel orgId={p.organizationId} projectId={p.id} canSubmit canReview={false} />}
          </div>
        )}

        {active === "evenement" && (
          <div className="stack">
            {events.map((ev) => (
              <section key={ev.id} className="card stack-sm">
                <SectionHead icon={CalendarDays} title={ev.title} desc={`${t(FORMAT_LABEL[ev.format])}${ev.internal ? ` · ${t("réunion interne")}` : ""}`} />
                <ul className="plain stack-sm text-sm">
                  <li><CalendarDays size={14} />{" "}{fmtDateTime(locale, ev.startsAt)}{ev.durationMinutes ? ` · ${formatDuration(ev.durationMinutes, locale)}` : ""}</li>
                  <li><MapPin size={14} />{" "}{ev.format === "DISTANCIEL" ? t("En ligne") : [ev.venue, ev.city].filter(Boolean).join(", ") || t("Lieu à préciser")}</li>
                  {engaged && ev.onlineUrl && ev.format !== "PRESENTIEL" && <li>{t("Lien de connexion :")}{" "}<a href={ev.onlineUrl} target="_blank" rel="noreferrer">{ev.onlineUrl}</a></li>}
                </ul>
                {ev.program && <><h3>{t("Programme")}</h3><p className="pre-line text-sm">{ev.program}</p></>}
                {ev.publishedAt && !ev.internal && <Link className="link" href={`/evenements/${ev.id}`}>{t("Voir la page publique de l'événement")}</Link>}
              </section>
            ))}
          </div>
        )}
      </main>
    </>
  );
}
