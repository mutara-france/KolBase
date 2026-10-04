import { Bell, BellRing } from "lucide-react";
import { db } from "@/lib/db";
import { toggleFollow } from "@/lib/follow-actions";

/** Bouton « Suivre » : ajoute le profil au fil « Mes suivis ». Sans compte, mène à la connexion. */
export async function FollowButton({ type, id, userId, label }: { type: "practitioner" | "organization"; id: string; userId: string | null; label: string }) {
  const following = userId
    ? !!(await db.follow.findFirst({ where: { userId, ...(type === "organization" ? { organizationId: id } : { practitionerId: id }) } }))
    : false;
  return (
    <form action={toggleFollow}>
      <input type="hidden" name="type" value={type} />
      <input type="hidden" name="id" value={id} />
      <button className={following ? "btn secondary" : "btn ghost"} title={following ? "Ne plus suivre" : undefined}>
        {following ? <><BellRing size={14} /> Mises à jour activées</> : <><Bell size={14} /> Suivre {label}</>}
      </button>
    </form>
  );
}
