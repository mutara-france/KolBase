import Link from "next/link";
import { Download } from "lucide-react";
import { BAROMETRE_PDF } from "@/lib/etudes";
import { getT } from "@/lib/i18n/server";

/**
 * Encart du baromètre : dans la liste des actualités, il mène à la page de l'étude ; sous un article de la rubrique
 * « Études », le lecteur a déjà le contexte et télécharge directement le PDF.
 */
export async function EtudePromo({ download = false }: { download?: boolean }) {
  const { t } = await getT();
  const text = (
    <div>
      <span className="eyebrow-sm">{t("Étude KolBase · accès libre")}</span>
      <strong>{t("Baromètre des collaborations dentaires 2022-2025")}</strong>
      <p>{t("134 583 déclarations Transparence Santé lues sous l'angle de la profession : chiffres clés, entreprises, recommandations.")}</p>
    </div>
  );
  if (!download) {
    return (
      <Link href="/barometre" className="card etude-promo">
        {text}
        <span className="btn">{t("Télécharger l'étude")}</span>
      </Link>
    );
  }
  return (
    <aside className="card etude-promo">
      {text}
      <a className="btn" href={BAROMETRE_PDF} download>
        <Download size={16} aria-hidden /> {t("Télécharger l'étude")}
      </a>
    </aside>
  );
}
