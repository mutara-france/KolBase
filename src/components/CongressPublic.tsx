import Link from "next/link";
import { CalendarRange, FileText, Handshake } from "lucide-react";
import { SectionHead } from "@/components/UI";
import { abstractsOpen, levelRank, partnerLevelLabel, partnerSecured, programByDay, programKindLabel } from "@/lib/congress";
import { logoSrc } from "@/lib/logos";
import { db } from "@/lib/db";
import { fmtDate, fmtTime, type Locale } from "@/lib/i18n";
import { getT } from "@/lib/i18n/server";

const dayLabel = (iso: string, locale: Locale) => fmtDate(locale, new Date(`${iso}T12:00:00Z`), { weekday: "long", day: "numeric", month: "long" });

/** Programme détaillé par jour, horaires, salle, nature ; symposium d'un partenaire signalé comme tel. */
export async function CongressProgram({ eventId }: { eventId: string }) {
  const { t, locale } = await getT();
  const items = await db.programItem.findMany({ where: { eventId }, include: { room: { select: { name: true } }, partner: { select: { name: true, status: true } } } });
  if (!items.length) return null;
  return (
    <section className="card stack-sm" aria-labelledby="programme-detaille">
      <SectionHead icon={CalendarRange} id="programme-detaille" title={t("Programme détaillé")} />
      {programByDay(items).map((d) => (
        <div key={d.day} className="stack-xs">
          <h3>{dayLabel(d.day, locale)}</h3>
          <ul className="plain stack-xs program-list">
            {d.items.map((i) => (
              <li key={i.id}>
                <strong>{fmtTime(locale, i.startsAt)}–{fmtTime(locale, i.endsAt)}</strong>{i.room ? <span className="muted"> · {i.room.name}</span> : null}
                <div>
                  <span className="tag">{t(programKindLabel(i.kind))}</span> {i.title}
                  {i.kind === "symposium" && i.partner && partnerSecured(i.partner.status) && <span className="muted text-sm"> · {t("organisé par {name}", { name: i.partner.name })}</span>}
                </div>
                {i.speakers && <div className="text-sm muted">{i.speakers}</div>}
              </li>
            ))}
          </ul>
        </div>
      ))}
    </section>
  );
}

/** Partenaires acquis (convention signée), par niveau ; transparence sur le financement de l'événement. */
export async function EventPartnersPanel({ eventId }: { eventId: string }) {
  const { t } = await getT();
  const list = (await db.eventPartner.findMany({ where: { eventId, showLogo: true, status: { in: ["signed", "paid"] } }, include: { organization: { select: { id: true, logoUpdatedAt: true, listed: true } } } }))
    .sort((a, b) => levelRank(a.level) - levelRank(b.level) || a.name.localeCompare(b.name));
  if (!list.length) return null;
  return (
    <section className="card stack-sm" aria-labelledby="partenaires-evenement">
      <SectionHead icon={Handshake} id="partenaires-evenement" title={t("Partenaires")} desc={t("Ils soutiennent l'événement ; le contenu scientifique relève du seul comité.")} />
      <ul className="plain partner-list">
        {list.map((p) => {
          const logo = p.organization ? logoSrc(p.organization) : null;
          const name = p.organization?.listed ? <Link href={`/structures/${p.organization.id}`}>{p.name}</Link> : p.name;
          return (
            <li key={p.id} className="partner-item">
              {logo && <img src={logo} alt="" width={40} height={40} className="partner-logo" />}
              <span><strong>{name}</strong><span className="text-xs muted"> · {t(partnerLevelLabel(p.level))}</span></span>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

/** Appel à communications ouvert : date limite, thèmes, lien vers la soumission. */
export async function AbstractsCallPanel({ eventId }: { eventId: string }) {
  const { t, locale } = await getT();
  const e = await db.event.findUnique({ where: { id: eventId }, select: { abstractsDeadline: true, abstractTopics: true, publishedAt: true, cancelledAt: true } });
  if (!e || !abstractsOpen(e)) return null;
  return (
    <section className="card stack-sm" aria-labelledby="appel-communications">
      <SectionHead icon={FileText} id="appel-communications" title={t("Appel à communications")} desc={t("Soumettez un résumé jusqu'au {date} : communication orale ou poster.", { date: fmtDate(locale, e.abstractsDeadline!, { day: "numeric", month: "long", year: "numeric" }) })} />
      {e.abstractTopics.length > 0 && <div className="tags">{e.abstractTopics.map((x) => <span key={x} className="tag">{x}</span>)}</div>}
      <Link className="btn secondary small" href={`/evenements/${eventId}/communications`}>{t("Soumettre une communication")}</Link>
    </section>
  );
}
