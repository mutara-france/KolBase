import Link from "next/link";
import { X } from "lucide-react";
import { AutoSubmitSelect } from "@/components/AutoSubmit";

/**
 * Filtres des listes (opportunités…) : un formulaire GET, des listes déroulantes qui s'appliquent dès qu'on les change
 * (le bouton reste pour une navigation sans JavaScript), et les filtres actifs en pastilles que l'on retire d'un clic.
 */

export type FilterOption = { value: string; label: string };

/** Liste déroulante d'un filtre : « Tous » en premier, appliquée au changement. */
export function FilterSelect({ name, label, value, all, options }: { name: string; label: string; value: string; all: string; options: FilterOption[] }) {
  return (
    <AutoSubmitSelect name={name} defaultValue={value} aria-label={label} title={label}>
      <option value="">{all}</option>
      {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
    </AutoSubmitSelect>
  );
}

/** Pastilles des filtres actifs : chacune retire son filtre ; « Tout effacer » les retire tous. */
export function ActiveFilters({ path, params, labels, clearLabel, ariaLabel }: { path: string; params: Record<string, string>; labels: Record<string, string>; clearLabel: string; ariaLabel: string }) {
  const active = Object.entries(params).filter(([k, v]) => v && labels[k]);
  if (active.length === 0) return null;
  const without = (key: string) => {
    const rest = new URLSearchParams(Object.entries(params).filter(([k, v]) => k !== key && v));
    const qs = rest.toString();
    return qs ? `${path}?${qs}` : path;
  };
  return (
    <div className="chips active-filters" role="group" aria-label={ariaLabel}>
      {active.map(([k]) => (
        <Link key={k} href={without(k)} className="chip active chip-x">{labels[k]} <X size={13} aria-hidden /></Link>
      ))}
      {active.length > 1 && <Link href={path} className="text-sm">{clearLabel}</Link>}
    </div>
  );
}

/** Onglets-filtres en pastilles (statut), avec leur décompte. */
export function FilterChips({ path, params, name, value, options }: { path: string; params: Record<string, string>; name: string; value: string; options: (FilterOption & { count?: number })[] }) {
  const href = (v: string) => {
    const qs = new URLSearchParams(Object.entries({ ...params, [name]: v }).filter(([, x]) => x)).toString();
    return qs ? `${path}?${qs}` : path;
  };
  return (
    <div className="chips">
      {options.map((o) => (
        <Link key={o.value || "tous"} href={href(o.value)} className={`chip${value === o.value ? " active" : ""}`}>
          {o.label}{o.count != null ? <span className="chip-count">{o.count}</span> : null}
        </Link>
      ))}
    </div>
  );
}
