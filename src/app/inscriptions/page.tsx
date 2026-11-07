import { SectionHead, PageHead, EmptyState } from "@/components/UI";
import Link from "next/link";
import { CalendarClock, CalendarDays, CalendarX, FileDown, History, QrCode, Star, Video } from "lucide-react";
import { eventEnded } from "@/lib/event-followup";
import { SiteHeader } from "@/components/SiteHeader";
import { SectionNav } from "@/components/SectionNav";
import { practitionerSectionTabs } from "@/lib/nav";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { TZ } from "@/lib/events";
import { fmtEur, intlLocale } from "@/lib/i18n";
import { getT } from "@/lib/i18n/server";
import { pointedPastEvents } from "@/lib/checkin";
import { isAbsent } from "@/lib/indicators";
import { cancelRegistration } from "@/lib/event-actions";
import { ConfirmButton } from "@/components/ConfirmButton";

export async function generateMetadata() {
  const { t } = await getT();
  return { title: `${t("Mes inscriptions")} — KolBase` };
}

export default async function Page({ searchParams }: { searchParams: Promise<{ annulee?: string }> }) {
  const { annulee } = await searchParams;
  const user = await requireUser();
  const { t, locale } = await getT();
  const formatDateTime = (d: Date) =>
    d.toLocaleString(intlLocale(locale), { timeZone: TZ, weekday: "long", day: "numeric", month: "long", year: "numeric", hour: "2-digit", minute: "2-digit" });
  const regs = await db.registration.findMany({
    where: { userId: user.id },
    include: { event: { include: { organization: { select: { name: true, verification: true } } } }, benefits: { include: { benefit: true } }, survey: { select: { id: true } } },
    orderBy: { event: { startsAt: "asc" } },
  });
  const now = new Date();
  // Absent au pointage d'un événement passé : les prestations acceptées n'ont pas été consommées, ni déclarées.
  const pointed = await pointedPastEvents(regs.map((r) => r.eventId), now);
  const absent = new Set(regs.filter((r) => r.benefits.length > 0 && !r.declared && isAbsent(r, pointed.has(r.eventId))).map((r) => r.id));
  // Un événement en cours reste « à venir » jusqu'à sa fin : badge et lien de connexion encore utiles.
  // Un événement annulé par l'organisation est rangé à part, avec son motif.
  const upcoming = regs.filter((r) => !r.cancelledAt && !eventEnded(r.event, now));
  const past = regs.filter((r) => !r.cancelledAt && eventEnded(r.event, now));
  const cancelled = regs.filter((r) => r.cancelledAt);

  const Row = ({ r }: { r: (typeof regs)[number] }) => {
    const total = r.benefits.reduce((s, b) => s + b.valueCents, 0);
    if (r.cancelledAt)
      return (
        <div className="card tile reg-tile">
          <Link href={`/evenements/${r.eventId}`} className="reg-tile-link">
            <strong>{r.event.title}</strong> <span className="pill bad">{t("Événement annulé")}</span>
            <span className="muted">{formatDateTime(r.event.startsAt)} · {r.event.organization.name}</span>
            {r.event.cancelReason && <span className="muted">{t("Motif : {note}", { note: r.event.cancelReason })}</span>}
          </Link>
        </div>
      );
    // Organisation suspendue par KolBase : la page de l'événement est masquée ; ni lien vers elle, ni badge.
    if (r.event.organization.verification === "SUSPENDED")
      return (
        <div className="card tile reg-tile">
          <div className="reg-tile-link">
            <strong>{r.event.title}</strong> <span className="pill wait">{t("Événement momentanément indisponible")}</span>
            <span className="muted">{formatDateTime(r.event.startsAt)} · {r.event.organization.name}</span>
            <span className="muted">{t("La page de l'événement est momentanément masquée sur KolBase. Votre inscription est conservée ; l'organisateur vous écrira si l'événement change.")}</span>
          </div>
        </div>
      );
    const badge = !eventEnded(r.event, now) && r.event.format !== "DISTANCIEL";
    return (
      <div className="card tile reg-tile">
        <Link href={`/evenements/${r.eventId}`} className="reg-tile-link">
          <strong>{r.event.title}</strong>
          <span className="muted">{formatDateTime(r.event.startsAt)} · {r.event.organization.name}{r.event.startsAt <= now && !eventEnded(r.event, now) && ` · ${t("en cours")}`}</span>
          <span className="muted">
            {total === 0 ? t("Aucune prestation acceptée") : `${r.benefits.map((b) => t(b.benefit.label)).join(", ")} · ${fmtEur(locale, total)}`}
            {r.declared && ` · ${t("déclaré")}`}
            {r.checkedInAt && ` · ${t("présence enregistrée")}`}
            {absent.has(r.id) && ` · ${t("absent : non déclaré")}`}
          </span>
        </Link>
        {badge && <Link className="btn small secondary" href={`/inscriptions/${r.id}/badge`}><QrCode size={14} /> {t("Mon badge d'accueil")}</Link>}
        {r.event.format !== "PRESENTIEL" && !eventEnded(r.event, now) && (
          r.event.onlineUrl
            ? <p className="online-link text-sm"><Video size={14} /> {t("Lien de connexion :")} <a href={r.event.onlineUrl} target="_blank" rel="noopener noreferrer">{r.event.onlineUrl}</a></p>
            : <p className="muted text-sm"><Video size={14} /> {t("Le lien de connexion vous sera communiqué par l'organisateur avant l'événement.")}</p>
        )}
        {/* Annulation (deux temps) : avant le début de l'événement, tant que l'inscription n'est pas déclarée. */}
        {!r.declared && r.event.startsAt > now && (
          <form action={cancelRegistration} className="reg-actions">
            <input type="hidden" name="eventId" value={r.eventId} />
            <input type="hidden" name="from" value="inscriptions" />
            <ConfirmButton localized className="btn small ghost" confirm={t("annuler mon inscription")} summary={r.benefits.length > 0 ? t("Votre place est libérée et les prestations acceptées sont retirées. Un e-mail vous confirme l'annulation.") : t("Votre place est libérée. Un e-mail vous confirme l'annulation.")}>
              {t("Annuler mon inscription")}
            </ConfirmButton>
          </form>
        )}
        {/* Attestation et avis : réservés aux présents (pointés à l'accueil). */}
        {eventEnded(r.event, now) && (r.checkedInAt || (!r.survey && !pointed.has(r.eventId))) && (
          <div className="actions reg-actions">
            {r.checkedInAt && <a className="btn small secondary" href={`/inscriptions/${r.id}/attestation`}><FileDown size={14} /> {t("Mon attestation de présence")}</a>}
            {!r.survey && <Link className="btn small ghost" href={`/evenements/${r.eventId}/avis`}><Star size={14} /> {t("Donner mon avis")}</Link>}
          </div>
        )}
      </div>
    );
  };

  return (
    <>
      <SiteHeader />
      <main className="stack">
        {user.practitioner?.listed && <SectionNav tabs={practitionerSectionTabs("agenda").map((tab) => ({ ...tab, label: t(tab.label) }))} active="inscriptions" label={t("Rubrique Mes inscriptions")} />}
        <PageHead title={t("Mes inscriptions")} desc={t("Les événements auxquels vous assistez. Les avantages que vous acceptez sont conventionnés et déclarés par l'organisateur.")}>
          <a className="btn ghost small" href="/inscriptions/calendrier">{t("Exporter vers mon agenda (.ics)")}</a>
        </PageHead>
        {annulee && <p className="notice ok">{t("Inscription annulée. Un e-mail vous le confirme.")}</p>}
        {regs.length === 0 && (
          <div className="card empty">
            <EmptyState icon={CalendarDays} title={t("Aucune inscription.")} action={<Link className="btn secondary small" href="/evenements">{t("Voir l'agenda")}</Link>}>
              {t("Inscrivez-vous aux événements de l'agenda : vos badges, attestations et avantages se retrouvent ici.")}
            </EmptyState>
          </div>
        )}
        {/* Une grille par période, comme « Mes interventions » : des cartes de même largeur, sans vide à droite. */}
        {upcoming.length > 0 && <SectionHead icon={CalendarClock} title={t("À venir")} />}
        {upcoming.length > 0 && <div className="grid-2">{upcoming.map((r) => <Row key={r.id} r={r} />)}</div>}
        {past.length > 0 && <SectionHead icon={History} title={t("Passés")} />}
        {past.length > 0 && <div className="grid-2">{past.map((r) => <Row key={r.id} r={r} />)}</div>}
        {cancelled.length > 0 && <SectionHead icon={CalendarX} title={t("Annulés par l'organisateur")} />}
        {cancelled.length > 0 && <div className="grid-2">{cancelled.map((r) => <Row key={r.id} r={r} />)}</div>}
      </main>
    </>
  );
}
