"use client";

import { useActionState, useMemo, useState } from "react";
import { Check, Search } from "lucide-react";
import { setPresence } from "@/lib/checkin-actions";
import { useT } from "@/components/I18nProvider";

/** Bouton « Présent » (ou annulation) d'une inscription. */
export function PresenceButton({ registrationId, checkedAt, big = false }: { registrationId: string; checkedAt: string | null; big?: boolean }) {
  const t = useT();
  const [state, action, pending] = useActionState(setPresence, undefined);
  return (
    <form action={action} className="presence-form">
      <input type="hidden" name="registrationId" value={registrationId} />
      {checkedAt ? (
        <>
          <span className="pill ok"><Check size={12} />{" "}{t("Présent · {checkedAt}", { checkedAt })}</span>
          <button className="link danger" name="undo" value="1" disabled={pending}>{t("Annuler")}</button>
        </>
      ) : (
        <button className={`btn${big ? "" : " small"}`} disabled={pending}>{pending ? "…" : big ? t("Confirmer la présence") : t("Présent")}</button>
      )}
      {state?.error && <span className="checkin-error" role="alert">{state.error}</span>}
    </form>
  );
}

export type CheckinRow = { id: string; name: string; detail: string; checkedAt: string | null };

const norm = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

/** Liste de pointage filtrable (nom, profession, structure). */
export function CheckinList({ rows, open }: { rows: CheckinRow[]; open: boolean }) {
  const t = useT();
  const [q, setQ] = useState("");
  const [onlyMissing, setOnlyMissing] = useState(false);
  const shown = useMemo(() => rows.filter((r) => (!onlyMissing || !r.checkedAt) && norm(`${r.name} ${r.detail}`).includes(norm(q.trim()))), [rows, q, onlyMissing]);
  return (
    <div className="stack-sm">
      <div className="checkin-tools">
        <label className="checkin-search">
          <Search size={16} aria-hidden />
          <input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder={t("Rechercher un participant")} aria-label={t("Rechercher un participant")} />
        </label>
        <label className="check"><input type="checkbox" checked={onlyMissing} onChange={(e) => setOnlyMissing(e.target.checked)} />{" "}{t("Non pointés seulement")}</label>
      </div>
      {shown.length === 0 && <p className="muted">{t("Aucun participant ne correspond.")}</p>}
      <ul className="checkin-list">
        {shown.map((r) => (
          <li key={r.id} className={r.checkedAt ? "done" : ""}>
            <span><strong>{r.name}</strong><small>{r.detail}</small></span>
            {open ? <PresenceButton registrationId={r.id} checkedAt={r.checkedAt} /> : r.checkedAt ? <span className="pill ok">{t("Présent · {checkedAt}", { checkedAt: r.checkedAt })}</span> : null}
          </li>
        ))}
      </ul>
    </div>
  );
}
