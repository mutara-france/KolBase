import Link from "next/link";
import { FileDown, QrCode, Star, Video } from "lucide-react";
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

export async function generateMetadata() {
  const { t } = await getT();
  return { title: `${t("Mes inscriptions")} — KolBase` };
}

export default async function Page() {
  const user = await requireUser();
  const { t, locale } = await getT();
  const formatDateTime = (d: Date) =>
    d.toLocaleString(intlLocale(locale), { timeZone: TZ, weekday: "long", day: "numeric", month: "long", year: "numeric", hour: "2-digit", minute: "2-digit" });
  const regs = await db.registration.findMany({
    where: { userId: user.id },
    include: { event: { include: { organization: { select: { name: true } } } }, benefits: { include: { benefit: true } }, survey: { select: { id: true } } },
    orderBy: { event: { startsAt: "asc" } },
  });
  const now = new Date();
  // Absent au pointage d'un événement passé : les prestations acceptées n'ont pas été consommées, ni déclarées.
  const pointed = await pointedPastEvents(regs.map((r) => r.eventId), now);
  const absent = new Set(regs.filter((r) => r.benefits.length > 0 && !r.declared && isAbsent(r, pointed.has(r.eventId))).map((r) => r.id));
  const upcoming = regs.filter((r) => r.event.startsAt >= now);
  const past = regs.filter((r) => r.event.startsAt < now);

  const Row = ({ r }: { r: (typeof regs)[number] }) => {
    const total = r.benefits.reduce((s, b) => s + b.valueCents, 0);
    const badge = r.event.startsAt >= now && r.event.format !== "DISTANCIEL";
    return (
      <div className="card tile reg-tile">
        <Link href={`/evenements/${r.eventId}`} className="reg-tile-link">
          <strong>{r.event.title}</strong>
          <span className="muted">{formatDateTime(r.event.startsAt)} · {r.event.organization.name}</span>
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
      <main className="narrow stack">
        {user.practitioner?.listed && <SectionNav tabs={practitionerSectionTabs("agenda").map((tab) => ({ ...tab, label: t(tab.label) }))} active="inscriptions" label={t("Rubrique Agenda")} />}
        <div className="actions spread">
          <h1>{t("Mes inscriptions")}</h1>
          <a className="btn ghost small" href="/inscriptions/calendrier">{t("Exporter vers mon agenda (.ics)")}</a>
        </div>
        <p className="muted">{t("Les événements auxquels vous assistez. Les avantages que vous acceptez sont conventionnés et déclarés par l'organisateur.")}</p>
        {regs.length === 0 && <p className="muted">{t("Aucune inscription.")} <Link href="/evenements">{t("Voir l'agenda")}</Link></p>}
        {upcoming.length > 0 && <h2>{t("À venir")}</h2>}
        {upcoming.map((r) => <Row key={r.id} r={r} />)}
        {past.length > 0 && <h2>{t("Passés")}</h2>}
        {past.map((r) => <Row key={r.id} r={r} />)}
      </main>
    </>
  );
}
