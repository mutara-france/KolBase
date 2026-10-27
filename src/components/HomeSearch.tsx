"use client";

import { useState } from "react";
import { Search } from "lucide-react";

type Tab = { id: "experts" | "evenements" | "appels" | "structures"; label: string; count: number };

/** Module de recherche de l'accueil : un onglet par annuaire public, formulaire GET vers la page correspondante. */
export function HomeSearch({ counts, interventionTypes }: { counts: { experts: number; events: number; calls: number; organizations: number }; interventionTypes: readonly string[] }) {
  const tabs: Tab[] = [
    { id: "experts", label: "Praticiens", count: counts.experts },
    { id: "evenements", label: "Événements", count: counts.events },
    { id: "appels", label: "Opportunités", count: counts.calls },
    { id: "structures", label: "Organisations", count: counts.organizations },
  ];
  const [tab, setTab] = useState<Tab["id"]>("experts");
  const placeholder = {
    experts: "Implantologie, Dr Durand…",
    evenements: "Live surgery, parodontologie…",
    appels: "Formateur, étude clinique…",
    structures: "Industriel, société savante…",
  }[tab];

  return (
    <form className="search-card" action={`/${tab}`} method="get" role="search" aria-label="Rechercher sur KolBase">
      <div className="search-tabs">
        {tabs.map((t) => (
          <button key={t.id} type="button" className="search-tab" aria-pressed={tab === t.id} onClick={() => setTab(t.id)}>
            {t.label}<span>{t.count}</span>
          </button>
        ))}
      </div>
      <div className="search-fields">
        <div className="search-field wide">
          <label htmlFor="home-q">{tab === "experts" ? "Spécialité ou nom" : "Mots-clés"}</label>
          <input id="home-q" name="q" type="search" placeholder={placeholder} autoComplete="off" />
        </div>
        {tab === "experts" && (
          <div className="search-field">
            <label htmlFor="home-type">Type d&apos;intervention</label>
            <select id="home-type" name="type" defaultValue="">
              <option value="">Tous les types</option>
              {interventionTypes.map((t) => <option key={t} value={t}>{t}</option>)}
            </select>
          </div>
        )}
        {(tab === "experts" || tab === "evenements") && (
          <div className="search-field">
            <label htmlFor="home-ville">Ville</label>
            <input id="home-ville" name="ville" type="text" placeholder="Toute la France" autoComplete="address-level2" />
          </div>
        )}
        <button type="submit" className="search-submit"><Search size={20} aria-hidden /> Rechercher</button>
      </div>
    </form>
  );
}
