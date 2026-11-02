import Link from "next/link";
import { SiteHeader } from "@/components/SiteHeader";
import { StatusPill } from "@/components/ProjectBits";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { collabType, recruitmentOpen } from "@/lib/projects";
import { fmtDate, fmtEur } from "@/lib/i18n";
import { getT } from "@/lib/i18n/server";

export async function generateMetadata() {
  const { t } = await getT();
  return { title: `${t("Mes sollicitations")} — KolBase` };
}

export default async function Page() {
  const user = await requireUser();
  const { t, locale } = await getT();
  const links = user.practitioner
    ? await db.projectExpert.findMany({
        where: { practitionerId: user.practitioner.id },
        include: { project: { include: { organization: { select: { name: true } } } } },
        orderBy: { createdAt: "desc" },
      })
    : [];
  const pending = links.filter((l) => l.status === "ATT_EXPERTS" && recruitmentOpen(l.project.status));
  const others = links.filter((l) => !pending.includes(l));

  const Tile = ({ l }: { l: (typeof links)[number] }) => {
    const label = collabType(l.project.typeId)?.label;
    return (
      <Link href={`/sollicitations/${l.id}`} className="card tile">
        <strong>{l.project.title}</strong>
        <span className="muted">{l.project.organization.name} · {label && t(label)} · {l.feeCents != null ? t("{amount} HT", { amount: fmtEur(locale, l.feeCents) }) : "—"}</span>
        <span className="muted">{t("Reçue le {date}", { date: fmtDate(locale, l.createdAt) })}</span>
        <StatusPill status={l.status === "ATT_EXPERTS" && !recruitmentOpen(l.project.status) ? "DECLINE" : l.status} />
      </Link>
    );
  };

  return (
    <>
      <SiteHeader />
      <main className="narrow stack">
        <h1>{t("Mes sollicitations")}</h1>
        {!user.practitioner?.listed && <p className="notice warn">{t("Référencez-vous comme expert dans")} <Link href="/compte">{t("Mon compte")}</Link> {t("pour recevoir des sollicitations.")}</p>}
        {links.length === 0 && <p className="muted">{t("Aucune sollicitation pour l'instant.")}</p>}
        {pending.length > 0 && <h2>{t("À traiter ({n})", { n: pending.length })}</h2>}
        {pending.map((l) => <Tile key={l.id} l={l} />)}
        {others.length > 0 && <h2>{t("Historique")}</h2>}
        {others.map((l) => <Tile key={l.id} l={l} />)}
      </main>
    </>
  );
}
