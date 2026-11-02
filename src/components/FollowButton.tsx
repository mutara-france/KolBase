import { Bell, BellRing } from "lucide-react";
import { db } from "@/lib/db";
import { toggleFollow } from "@/lib/follow-actions";
import { getT } from "@/lib/i18n/server";

/** Bouton « Suivre » : ajoute le profil au fil « Mes suivis ». Sans compte, mène à la connexion. `label` est déjà traduit. */
export async function FollowButton({ type, id, userId, label }: { type: "practitioner" | "organization"; id: string; userId: string | null; label: string }) {
  const following = userId
    ? !!(await db.follow.findFirst({ where: { userId, ...(type === "organization" ? { organizationId: id } : { practitionerId: id }) } }))
    : false;
  const { t } = await getT();
  return (
    <form action={toggleFollow}>
      <input type="hidden" name="type" value={type} />
      <input type="hidden" name="id" value={id} />
      <button className={following ? "btn secondary" : "btn ghost"} title={following ? t("Ne plus suivre") : undefined}>
        {following ? <><BellRing size={14} /> {t("Mises à jour activées")}</> : <><Bell size={14} /> {t("Suivre {label}", { label })}</>}
      </button>
    </form>
  );
}
