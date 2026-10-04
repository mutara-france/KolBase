import { SiteHeader } from "@/components/SiteHeader";

export function LegalPage({ title, updated, sections }: { title: string; updated: string; sections: [string, React.ReactNode][] }) {
  return (
    <>
      <SiteHeader variant="public" />
      <main className="narrow stack legal">
        <div>
          <h1>{title}</h1>
          <p className="muted">Dernière mise à jour : {updated}</p>
        </div>
        {sections.map(([h, body]) => (
          <section key={h} className="card">
            <h2>{h}</h2>
            {body}
          </section>
        ))}
      </main>
    </>
  );
}
