"use client";

import { useActionState, useState } from "react";
import { Notice } from "@/components/AuthForms";
import { ActionForm } from "@/components/ActionForm";
import { useT } from "@/components/I18nProvider";
import { adminSetGroup, saveChannel, savePerimeter, transferProposal } from "@/lib/routing-actions";
import { DEFAULT_IP_POLICY, DEFAULT_RESPONSE_DAYS, TOPICS } from "@/lib/routing";

type Opt = { id: string; name: string };

/** Périmètre de l'entité dans son groupe : pays couverts (codes ISO), marques. */
export function PerimeterForm({ orgId, countries, brands }: { orgId: string; countries: string; brands: string }) {
  const t = useT();
  const [state, action, pending] = useActionState(savePerimeter, undefined);
  return (
    <ActionForm action={action} className="form stack-sm">
      <Notice state={state} />
      <input type="hidden" name="orgId" value={orgId} />
      <label>{t("Pays couverts")}<input name="countries" defaultValue={countries} placeholder="FR, BE, LU" />
        <span className="hint">{t("Codes pays à deux lettres. Vide : siège du groupe, qui reçoit les propositions des pays sans entité.")}</span>
      </label>
      <label>{t("Marques")}<input name="brands" defaultValue={brands} placeholder={t("Séparées par des virgules")} /></label>
      <button className="btn small secondary" disabled={pending}>{pending ? t("Enregistrement…") : t("Enregistrer le périmètre")}</button>
    </ActionForm>
  );
}

/** Canal d'un sujet : responsable, suppléant, délai de réponse ; idée de produit : conditions de soumission. */
export function ChannelForm({ orgId, members, init }: { orgId: string; members: Opt[]; init?: { topic: string; ownerId: string; backupId: string; responseDays: number; ipPolicy: string } }) {
  const t = useT();
  const [state, action, pending] = useActionState(saveChannel, undefined);
  const [topic, setTopic] = useState(init?.topic ?? "formation");
  return (
    <ActionForm action={action} className="form stack-sm">
      <Notice state={state} />
      <input type="hidden" name="orgId" value={orgId} />
      <div className="row">
        <label>{t("Sujet")}
          <select name="topic" value={topic} onChange={(e) => setTopic(e.target.value)} disabled={!!init}>
            {TOPICS.map((x) => <option key={x.id} value={x.id}>{t(x.label)}</option>)}
          </select>
          {init && <input type="hidden" name="topic" value={topic} />}
        </label>
        <label className="short">{t("Délai de réponse (jours)")}<input name="responseDays" type="number" min={1} max={60} defaultValue={init?.responseDays ?? DEFAULT_RESPONSE_DAYS} /></label>
      </div>
      <div className="row">
        <label>{t("Responsable")}
          <select name="ownerId" required defaultValue={init?.ownerId ?? ""}>
            <option value="" disabled>{t("— choisir —")}</option>
            {members.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
          </select>
        </label>
        <label>{t("Suppléant")}
          <select name="backupId" defaultValue={init?.backupId ?? ""}>
            <option value="">—</option>
            {members.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
          </select>
        </label>
      </div>
      {topic === "innovation" && (
        <label>{t("Conditions de soumission d'une idée")}<textarea name="ipPolicy" rows={3} defaultValue={init?.ipPolicy ?? ""} placeholder={t(DEFAULT_IP_POLICY)} /></label>
      )}
      <button className="btn small secondary" disabled={pending}>{pending ? t("Enregistrement…") : init ? t("Mettre à jour") : t("Ajouter le canal")}</button>
    </ActionForm>
  );
}

/** Transfert d'une proposition : autre entité du groupe ou autre sujet de l'organisation. */
export function TransferForm({ orgId, projectId, targets }: { orgId: string; projectId: string; targets: { value: string; label: string }[] }) {
  const t = useT();
  const [state, action, pending] = useActionState(transferProposal, undefined);
  if (state?.ok) return <p className="notice ok" role="status">{state.ok}</p>;
  return (
    <ActionForm action={action} className="form stack-sm">
      <Notice state={state} />
      <input type="hidden" name="orgId" value={orgId} />
      <input type="hidden" name="projectId" value={projectId} />
      <label>{t("Transmettre à")}
        <select name="target" required defaultValue="">
          <option value="" disabled>{t("— choisir —")}</option>
          {targets.map((x) => <option key={x.value} value={x.value}>{x.label}</option>)}
        </select>
      </label>
      <label>{t("Note (journal du dossier)")}<input name="note" maxLength={500} /></label>
      <button className="btn small secondary" disabled={pending}>{pending ? t("Envoi…") : t("Transmettre la proposition")}</button>
    </ActionForm>
  );
}

/** Rattachement d'une organisation à un groupe (administration KolBase, en français). */
export function AdminGroupForm({ orgId, groups, current }: { orgId: string; groups: Opt[]; current: string }) {
  const [state, action, pending] = useActionState(adminSetGroup, undefined);
  const [choice, setChoice] = useState(current);
  return (
    <ActionForm action={action} className="form inline-form">
      <Notice state={state} />
      <input type="hidden" name="orgId" value={orgId} />
      <label>Groupe
        <select name="groupId" value={choice} onChange={(e) => setChoice(e.target.value)}>
          <option value="">Aucun groupe</option>
          {groups.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
          <option value="nouveau">Nouveau groupe…</option>
        </select>
      </label>
      {choice === "nouveau" && <label>Nom du groupe<input name="newGroup" required maxLength={120} /></label>}
      <button className="btn small" disabled={pending}>{pending ? "Enregistrement…" : "Enregistrer"}</button>
    </ActionForm>
  );
}
