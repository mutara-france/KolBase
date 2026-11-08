import { FlaskConical } from "lucide-react";
import { getT } from "@/lib/i18n/server";

const TEXT = {
  expert: "Profil fictif, présenté pour la démonstration de KolBase : cette personne n'existe pas.",
  event: "Événement fictif, présenté pour la démonstration de KolBase : il n'aura pas lieu.",
  organisation: "Organisation fictive, présentée pour la démonstration de KolBase.",
} as const;

/** Contenu de démonstration (données fictives) : dit clairement sur la page qu'il ne s'agit pas d'une vraie fiche. */
export async function DemoNotice({ kind }: { kind: keyof typeof TEXT }) {
  const { t } = await getT();
  return (
    <p className="notice demo-notice" role="note">
      <FlaskConical size={16} aria-hidden /> {t(TEXT[kind])}
    </p>
  );
}

/** Étiquette « Démonstration » des cartes (experts, agenda). */
export async function DemoTag() {
  const { t } = await getT();
  return <span className="demo-tag">{t("Démonstration")}</span>;
}
