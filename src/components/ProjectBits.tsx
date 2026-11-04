import { Check } from "lucide-react";
import type { ProjectStatus } from "@/generated/prisma/client";
import { PIPELINE, STATUS_TONE, fmvCheck, statusLabel } from "@/lib/projects";
import { intlLocale } from "@/lib/i18n";
import { getT } from "@/lib/i18n/server";

/** Statut d'un dossier : libellé du glossaire (du point de vue de l'expert sur ses pages), traduit à l'affichage. */
export async function StatusPill({ status, viewer }: { status: ProjectStatus; viewer?: "expert" }) {
  const { t } = await getT();
  return <span className={`pill ${STATUS_TONE[status]}`}>{t(statusLabel(status, viewer))}</span>;
}

export async function Pipeline({ status, viewer }: { status: ProjectStatus; viewer?: "expert" }) {
  const { t } = await getT();
  const idx = PIPELINE.indexOf(status === "ORDRE" ? "VALIDE" : status === "BLOQUE" ? "EN_VALID" : status === "ATT_IND" ? "ATT_EXPERTS" : status);
  const blocked = status === "BLOQUE" || status === "REFUS_ORDRE";
  // Dossier terminé : toutes les étapes sont franchies.
  const doneAll = status === "TERMINE";
  return (
    <ol className="pipeline" aria-label={t("Étapes du dossier")}>
      {PIPELINE.map((s, i) => {
        const done = i < idx || (doneAll && i === idx);
        const current = i === idx && !doneAll;
        return (
          <li key={s} className={done ? "done" : current ? `current${blocked ? " bad" : ""}` : ""} aria-current={current ? "step" : undefined}>
            <span className="dot" aria-hidden>{done ? <Check size={13} strokeWidth={3} /> : i + 1}</span>
            <span className="lbl">{t(statusLabel(s, viewer))}</span>
          </li>
        );
      })}
    </ol>
  );
}

export function FmvBadge({ typeId, feeCents, units }: { typeId: string; feeCents: number | null; units: number | null }) {
  const c = fmvCheck(typeId, feeCents, units);
  if (!c) return null;
  const txt = `${Math.round(c.perUnit).toLocaleString("fr-FR")} €/${c.unit}`;
  // Repère indicatif interne (non réglementaire, non sourcé) : il éclaire la discussion, il ne vaut pas conformité.
  const range = `${c.min.toLocaleString("fr-FR")}–${c.max.toLocaleString("fr-FR")} €`;
  const title = `Repère indicatif KolBase : ${range} par ${c.unit}. Ce n'est pas un seuil réglementaire.`;
  if (c.verdict === "ok") return <span className="pill" title={title}>{txt} · dans le repère indicatif</span>;
  if (c.verdict === "below") return <span className="pill" title={title}>{txt} · sous le repère indicatif ({range})</span>;
  return <span className="pill wait" title={title}>{txt} · au-dessus du repère indicatif ({range}) : justification à documenter</span>;
}

type Msg = { id: string; body: string; createdAt: Date; author: { firstName: string; lastName: string }; authorId: string };

export async function Thread({ messages, meId }: { messages: Msg[]; meId: string }) {
  const { t, locale } = await getT();
  if (messages.length === 0) return <p className="muted">{t("Aucun message.")}</p>;
  return (
    <ul className="thread">
      {messages.map((m) => (
        <li key={m.id} className={m.authorId === meId ? "me" : ""}>
          <span className="muted">
            {m.author.firstName} {m.author.lastName} · {m.createdAt.toLocaleString(intlLocale(locale), { timeZone: "Europe/Paris", dateStyle: "short", timeStyle: "short" })}
          </span>
          <p>{m.body}</p>
        </li>
      ))}
    </ul>
  );
}
