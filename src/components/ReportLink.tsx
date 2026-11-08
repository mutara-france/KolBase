import Link from "next/link";
import { Flag } from "lucide-react";
import { getT } from "@/lib/i18n/server";

/** Lien « Signaler » d'un contenu public : le signalement rejoint le registre de l'équipe KolBase. */
export async function ReportLink({ type, id, label }: { type: "expert" | "organisation" | "evenement" | "avis"; id: string; label?: string }) {
  const { t } = await getT();
  return (
    <p className="report-link text-xs">
      <Link className="link muted" href={`/signaler?type=${type}&id=${encodeURIComponent(id)}`} rel="nofollow"><Flag size={12} aria-hidden /> {label ?? t("Signaler ce contenu")}</Link>
    </p>
  );
}
