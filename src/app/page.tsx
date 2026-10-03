import Link from "next/link";
import { SiteHeader } from "@/components/SiteHeader";

export default function Home() {
  return (
    <>
      <SiteHeader />
      <main>
        <h1>Trouvez le bon praticien. Montez la collaboration. Le reste suit.</h1>
        <p>
          Kolbase met en relation les chirurgiens-dentistes et les organisations du secteur — industriels,
          sociétés savantes, organismes de formation, associations. Chercher, proposer, candidater,
          contractualiser : tout part d&apos;une rencontre, et la paperasse réglementaire suit toute seule.
        </p>
        <div className="actions">
          <Link href="/inscription" className="btn">Créer mon compte praticien</Link>
          <Link href="/evenements" className="btn ghost">Voir l&apos;agenda</Link>
        </div>
        <span className="badge">Plateforme en construction</span>
      </main>
    </>
  );
}
