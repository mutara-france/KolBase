import type { ProjectStatus } from "@/generated/prisma/client";
import { PIPELINE, STATUS_LABEL, STATUS_TONE, fmvCheck } from "@/lib/projects";

export function StatusPill({ status }: { status: ProjectStatus }) {
  return <span className={`pill ${STATUS_TONE[status]}`}>{STATUS_LABEL[status]}</span>;
}

export function Pipeline({ status }: { status: ProjectStatus }) {
  const idx = PIPELINE.indexOf(status === "ORDRE" ? "VALIDE" : status === "BLOQUE" ? "EN_VALID" : status);
  return (
    <ol className="pipeline">
      {PIPELINE.map((s, i) => (
        <li key={s} className={i < idx ? "done" : i === idx ? "current" : ""}>{STATUS_LABEL[s]}</li>
      ))}
    </ol>
  );
}

export function FmvBadge({ typeId, feeCents, units }: { typeId: string; feeCents: number | null; units: number | null }) {
  const c = fmvCheck(typeId, feeCents, units);
  if (!c) return null;
  const txt = `${Math.round(c.perUnit).toLocaleString("fr-FR")} €/${c.unit}`;
  if (c.verdict === "ok") return <span className="pill ok" title={`Fourchette ${c.min}–${c.max} €`}>{txt} · dans la fourchette</span>;
  return (
    <span className="pill bad" title={`Fourchette ${c.min}–${c.max} €`}>
      {txt} · {c.verdict === "above" ? "au-dessus" : "en dessous"} de la fourchette ({c.min.toLocaleString("fr-FR")}–{c.max.toLocaleString("fr-FR")} €)
    </span>
  );
}

type Msg = { id: string; body: string; createdAt: Date; author: { firstName: string; lastName: string }; authorId: string };

export function Thread({ messages, meId }: { messages: Msg[]; meId: string }) {
  if (messages.length === 0) return <p className="muted">Aucun message.</p>;
  return (
    <ul className="thread">
      {messages.map((m) => (
        <li key={m.id} className={m.authorId === meId ? "me" : ""}>
          <span className="muted">
            {m.author.firstName} {m.author.lastName} · {m.createdAt.toLocaleString("fr-FR", { timeZone: "Europe/Paris", dateStyle: "short", timeStyle: "short" })}
          </span>
          <p>{m.body}</p>
        </li>
      ))}
    </ul>
  );
}
