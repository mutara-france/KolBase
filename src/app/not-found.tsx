import Link from "next/link";
import { SiteHeader } from "@/components/SiteHeader";

export const metadata = { title: "Page introuvable — KolBase", robots: { index: false } };

export default function NotFound() {
  return (
    <>
      <SiteHeader variant="public" />
      <main className="narrow stack">
        <section className="card form">
          <h1>Page introuvable</h1>
          <p className="muted">Cette page n&apos;existe pas, a été retirée, ou vous n&apos;y avez pas accès.</p>
          <div className="actions">
            <Link className="btn" href="/">Accueil</Link>
            <Link className="btn ghost" href="/experts">Experts</Link>
            <Link className="btn ghost" href="/evenements">Événements</Link>
          </div>
        </section>
      </main>
    </>
  );
}
