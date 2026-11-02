import Link from "next/link";
import { SiteHeader } from "@/components/SiteHeader";
import { SectionNav } from "@/components/SectionNav";
import { practitionerSectionTabs } from "@/lib/nav";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { TZ } from "@/lib/events";
import { fmtEur, intlLocale } from "@/lib/i18n";
import { getT } from "@/lib/i18n/server";

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
    include: { event: { include: { organization: { select: { name: true } } } }, benefits: { include: { benefit: true } } },
    orderBy: { event: { startsAt: "asc" } },
  });
  const now = new Date();
  const upcoming = regs.filter((r) => r.event.startsAt >= now);
  const past = regs.filter((r) => r.event.startsAt < now);

  const Row = ({ r }: { r: (typeof regs)[number] }) => {
    const total = r.benefits.reduce((s, b) => s + b.valueCents, 0);
    return (
      <Link href={`/evenements/${r.eventId}`} className="card tile">
        <strong>{r.event.title}</strong>
        <span className="muted">{formatDateTime(r.event.startsAt)} · {r.event.organization.name}</span>
        <span className="muted">
          {total === 0 ? t("Aucune prestation acceptée") : `${r.benefits.map((b) => t(b.benefit.label)).join(", ")} · ${fmtEur(locale, total)}`}
          {r.declared && ` · ${t("déclaré")}`}
        </span>
      </Link>
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
