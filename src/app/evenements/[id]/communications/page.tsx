import Link from "next/link";
import { notFound } from "next/navigation";
import { SiteHeader } from "@/components/SiteHeader";
import { ConfirmButton } from "@/components/ConfirmButton";
import { AbstractSubmitForm } from "@/components/CongressForms";
import { withdrawAbstract } from "@/lib/congress-actions";
import { ABSTRACT_STATUS, abstractFormatLabel, abstractsOpen, MAX_ABSTRACTS_PER_USER } from "@/lib/congress";
import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { fmtDate } from "@/lib/i18n";
import { getT } from "@/lib/i18n/server";

export async function generateMetadata() {
  const { t } = await getT();
  return { title: `${t("Appel à communications")} — KolBase`, robots: { index: false } };
}

/** Soumission d'une communication à un congrès et suivi des siennes (statut, format retenu, message du comité). */
export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await requireUser();
  const { t, locale } = await getT();
  const event = await db.event.findFirst({
    where: { id, publishedAt: { not: null }, inviteOnly: false, organization: { verification: "VERIFIED" } },
    select: { id: true, title: true, abstractsDeadline: true, abstractTopics: true, publishedAt: true, cancelledAt: true, organization: { select: { name: true } } },
  });
  if (!event) notFound();
  const mine = await db.abstract.findMany({ where: { eventId: id, userId: user.id }, include: { item: { select: { startsAt: true, room: { select: { name: true } } } } }, orderBy: { createdAt: "asc" } });
  const open = abstractsOpen(event);
  const active = mine.filter((a) => a.status !== "withdrawn").length;
  return (
    <>
      <SiteHeader />
      <main className="narrow stack">
        <p className="muted"><Link href={`/evenements/${id}`}>← {event.title}</Link></p>
        <div>
          <h1>{t("Appel à communications")}</h1>
          <p className="muted">
            {event.abstractsDeadline
              ? open ? t("« {title} », organisé par {org} : soumissions jusqu'au {date}. Le comité vous répond par e-mail.", { title: event.title, org: event.organization.name, date: fmtDate(locale, event.abstractsDeadline, { day: "numeric", month: "long", year: "numeric" }) })
                : t("L'appel à communications de « {title} » est clos.", { title: event.title })
              : t("« {title} » n'a pas d'appel à communications.", { title: event.title })}
          </p>
        </div>
        {mine.length > 0 && (
          <section className="card stack-sm" aria-labelledby="mes-communications">
            <h2 id="mes-communications">{t("Mes communications")}</h2>
            <ul className="plain stack-sm">
              {mine.map((a) => {
                const st = ABSTRACT_STATUS[a.status] ?? ABSTRACT_STATUS.submitted;
                return (
                  <li key={a.id} className="stack-xs">
                    <div className="flex-between"><strong>{a.title}</strong><span className={`pill ${st.tone}`}>{t(st.label)}{a.acceptedFormat ? ` · ${t(abstractFormatLabel(a.acceptedFormat) ?? "")}` : ""}</span></div>
                    <span className="text-sm muted">{a.authors} · {t("soumise le {date}", { date: fmtDate(locale, a.createdAt) })}</span>
                    {a.decisionNote && <p className="text-sm">{t("Message du comité : {note}", { note: a.decisionNote })}</p>}
                    {a.item && <p className="text-sm">{t("Au programme : {when}", { when: `${fmtDate(locale, a.item.startsAt, { weekday: "long", day: "numeric", month: "long", hour: "2-digit", minute: "2-digit" })}${a.item.room ? ` · ${a.item.room.name}` : ""}` })}</p>}
                    {a.status === "submitted" && open && (
                      <form action={withdrawAbstract}>
                        <input type="hidden" name="abstractId" value={a.id} />
                        <ConfirmButton className="link danger" confirm={t("retirer la communication")} summary={t("Le comité ne l'examinera pas.")} localized>{t("Retirer")}</ConfirmButton>
                      </form>
                    )}
                  </li>
                );
              })}
            </ul>
          </section>
        )}
        {open && (active < MAX_ABSTRACTS_PER_USER
          ? <section className="card stack-sm" aria-labelledby="soumettre"><h2 id="soumettre">{t("Soumettre une communication")}</h2><AbstractSubmitForm eventId={id} topics={event.abstractTopics} /></section>
          : <p className="notice">{t("Vous avez soumis le nombre maximal de communications (trois).")}</p>)}
      </main>
    </>
  );
}
