"use client";

import Link from "next/link";
import { useEffect } from "react";

/** Erreur inattendue : message sobre, nouvel essai possible, détail technique dans les journaux du serveur. */
export default function Error({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => console.error(error), [error]);
  return (
    <main className="narrow stack">
      <section className="card form">
        <h1>Une erreur est survenue</h1>
        <p className="muted">L&apos;opération n&apos;a pas abouti. Réessayez ; si le problème persiste, contactez-nous en indiquant la référence ci-dessous.</p>
        {error.digest && <p className="text-xs">Référence : <span className="mono">{error.digest}</span></p>}
        <div className="actions">
          <button className="btn" onClick={() => reset()}>Réessayer</button>
          <Link className="btn ghost" href="/">Accueil</Link>
        </div>
      </section>
    </main>
  );
}
