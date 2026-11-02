"use client";

import Link from "next/link";
import { useEffect } from "react";
import { useT } from "@/components/I18nProvider";

/** Erreur inattendue : message sobre, nouvel essai possible, détail technique dans les journaux du serveur. */
export default function Error({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  const t = useT();
  useEffect(() => console.error(error), [error]);
  return (
    <main className="narrow stack">
      <section className="card form">
        <h1>{t("Une erreur est survenue")}</h1>
        <p className="muted">{t("L'opération n'a pas abouti. Réessayez ; si le problème persiste, contactez-nous en indiquant la référence ci-dessous.")}</p>
        {error.digest && <p className="text-xs">{t("Référence :")} <span className="mono">{error.digest}</span></p>}
        <div className="actions">
          <button className="btn" onClick={() => reset()}>{t("Réessayer")}</button>
          <Link className="btn ghost" href="/">{t("Accueil")}</Link>
        </div>
      </section>
    </main>
  );
}
