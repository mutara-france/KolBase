/**
 * Ce que chaque métier de prestataire décrit de lui-même (capacités, équipements et services) et ce qu'il lui faut
 * pour chiffrer une demande (questions propres à la catégorie). Un prestataire présent dans plusieurs catégories
 * voit les champs de chacune, regroupés par métier. Un traiteur ne se voit pas demander ses chambres, ni un
 * transporteur ses places assises.
 */

export type CapacityField = { key: string; label: string; unit: string };
export type DetailField =
  | { key: string; label: string; kind: "choice"; options: { id: string; label: string }[] }
  | { key: string; label: string; kind: "multi"; options: { id: string; label: string }[] }
  | { key: string; label: string; kind: "number" | "date" | "time" | "text"; hint?: string };

type Profile = { capacities: CapacityField[]; equipment: string[]; details: DetailField[] };

const yes = [{ id: "oui", label: "Oui" }, { id: "non", label: "Non" }];

export const SUPPLIER_PROFILES: Record<string, Profile> = {
  salle: {
    capacities: [
      { key: "seats", label: "Places en théâtre (conférence)", unit: "places en théâtre" },
      { key: "classroom", label: "Places en classe", unit: "places en classe" },
      { key: "banquet", label: "Couverts assis", unit: "couverts assis" },
      { key: "cocktail", label: "Personnes en cocktail", unit: "personnes en cocktail" },
      { key: "subrooms", label: "Salles de sous-commission", unit: "salles de sous-commission" },
    ],
    equipment: ["Vidéoprojecteur et écran", "Sonorisation et micros", "Visioconférence", "Wi-Fi", "Lumière du jour", "Restauration sur place", "Parking", "Hébergement sur place", "Accès en transports en commun"],
    details: [
      { key: "configuration", label: "Configuration", kind: "choice", options: [
        { id: "theatre", label: "Théâtre" }, { id: "classe", label: "Classe" }, { id: "u", label: "En U" }, { id: "banquet", label: "Banquet" }, { id: "cocktail", label: "Cocktail" }, { id: "ateliers", label: "Ateliers (îlots)" },
      ] },
      { key: "subrooms", label: "Salles de sous-commission", kind: "number" },
      { key: "technique", label: "Technique attendue", kind: "multi", options: [
        { id: "projection", label: "Vidéoprojecteur et écran" }, { id: "son", label: "Sonorisation et micros" }, { id: "visio", label: "Visioconférence" }, { id: "wifi", label: "Wi-Fi pour les participants" },
      ] },
      { key: "option", label: "Pose d'option souhaitée jusqu'au", kind: "date", hint: "Date jusqu'à laquelle la salle vous est réservée sans engagement." },
    ],
  },
  restauration: {
    capacities: [
      { key: "banquet", label: "Couverts assis", unit: "couverts assis" },
      { key: "cocktail", label: "Personnes en cocktail", unit: "personnes en cocktail" },
    ],
    equipment: ["Service à table", "Buffet", "Cocktail", "Plateaux-repas", "Menus végétariens", "Sans gluten", "Halal", "Personnel de service", "Vaisselle et nappage", "Boissons alcoolisées"],
    details: [
      { key: "format", label: "Format", kind: "choice", options: [
        { id: "cocktail", label: "Cocktail" }, { id: "buffet", label: "Buffet" }, { id: "assis", label: "Repas assis" }, { id: "plateaux", label: "Plateaux-repas" }, { id: "pause", label: "Pause café" },
      ] },
      { key: "serviceTime", label: "Heure de service", kind: "time" },
      { key: "drinks", label: "Boissons", kind: "choice", options: [
        { id: "sans", label: "Eaux et softs" }, { id: "vins", label: "Avec vins" }, { id: "aucune", label: "Aucune" },
      ] },
      { key: "staff", label: "Personnel de service", kind: "choice", options: yes },
    ],
  },
  hebergement: {
    capacities: [
      { key: "rooms", label: "Chambres", unit: "chambres" },
      { key: "meetingSeats", label: "Places en salle de réunion", unit: "places en salle de réunion" },
    ],
    equipment: ["Petit-déjeuner", "Salle de réunion", "Restaurant", "Parking", "Navette", "Chambres accessibles"],
    details: [
      { key: "arrival", label: "Arrivée", kind: "date" },
      { key: "departure", label: "Départ", kind: "date" },
      { key: "singles", label: "Chambres individuelles", kind: "number" },
      { key: "doubles", label: "Chambres doubles", kind: "number" },
      { key: "roomingBy", label: "Liste des chambres transmise au plus tard le", kind: "date", hint: "Après cette date, l'hôtel peut remettre en vente les chambres non attribuées." },
    ],
  },
  transport: {
    capacities: [
      { key: "vehicles", label: "Véhicules", unit: "véhicules" },
      { key: "vehicleSeats", label: "Places du plus grand véhicule", unit: "places dans le plus grand véhicule" },
    ],
    equipment: ["Autocar", "Minibus", "Voiture avec chauffeur", "Navette gare ou aéroport", "Véhicule accessible en fauteuil"],
    details: [
      { key: "routes", label: "Trajets et horaires", kind: "text", hint: "Un trajet par ligne : départ, arrivée, heure (ex. « Gare Lille-Europe → Grand Palais, 8 h 15 »)." },
      { key: "luggage", label: "Bagages", kind: "choice", options: yes },
    ],
  },
  audiovisuel: {
    capacities: [{ key: "crews", label: "Équipes techniques simultanées", unit: "équipes techniques simultanées" }],
    equipment: ["Captation vidéo", "Diffusion en direct", "Régie", "Traduction simultanée", "Sonorisation", "Éclairage", "Plateforme de webinaire"],
    details: [
      { key: "rooms", label: "Salles à équiper", kind: "number" },
      { key: "capture", label: "Captation", kind: "choice", options: yes },
      { key: "live", label: "Diffusion en direct", kind: "choice", options: yes },
      { key: "translation", label: "Traduction simultanée", kind: "choice", options: yes },
    ],
  },
  impression: {
    capacities: [{ key: "leadDays", label: "Délai de fabrication habituel (jours)", unit: "jours de fabrication en général" }],
    equipment: ["Badges", "Kakémonos", "Signalétique", "Programmes", "Grand format", "Livraison sur site"],
    details: [
      { key: "items", label: "Supports et quantités", kind: "text", hint: "Un support par ligne (ex. « 200 badges », « 4 kakémonos 85 × 200 »)." },
      { key: "deliveryBy", label: "Livraison au plus tard le", kind: "date" },
      { key: "proof", label: "Bon à tirer à valider avant le", kind: "date" },
    ],
  },
  evenementiel: {
    capacities: [{ key: "maxParticipants", label: "Plus grand événement géré (participants)", unit: "participants au plus grand événement géré" }],
    equipment: ["Gestion des inscriptions", "Logistique des participants", "Hébergement et transport", "Dossiers d'hospitalité (conformité)", "Scénographie", "Animation"],
    details: [
      { key: "budget", label: "Budget cible (€ HT)", kind: "number" },
      { key: "scope", label: "Périmètre confié", kind: "multi", options: [
        { id: "lieu", label: "Recherche du lieu" }, { id: "inscriptions", label: "Inscriptions" }, { id: "logistique", label: "Transport et hébergement" }, { id: "restauration", label: "Restauration" }, { id: "technique", label: "Technique" }, { id: "accueil", label: "Accueil sur place" },
      ] },
      { key: "fees", label: "Rémunération proposée", kind: "choice", options: [
        { id: "forfait", label: "Honoraires forfaitaires" }, { id: "pourcentage", label: "Pourcentage du budget" }, { id: "a-definir", label: "À proposer par l'agence" },
      ] },
    ],
  },
  communication: {
    capacities: [],
    equipment: ["Graphisme", "Vidéo", "Réseaux sociaux", "E-mailing", "Relations presse"],
    details: [
      { key: "deliverables", label: "Livrables", kind: "text", hint: "Un livrable par ligne." },
      { key: "dueBy", label: "Livraison attendue le", kind: "date" },
    ],
  },
};

const profile = (category: string): Profile => SUPPLIER_PROFILES[category] ?? { capacities: [], equipment: [], details: [] };

/** Champs de capacité d'un prestataire, par catégorie (sans doublon de clé). */
export function capacityFields(categories: string[]): { category: string; fields: CapacityField[] }[] {
  const seen = new Set<string>();
  return categories.map((c) => ({ category: c, fields: profile(c).capacities.filter((f) => !seen.has(f.key) && seen.add(f.key)) })).filter((g) => g.fields.length > 0);
}

/** Équipements et services proposés selon les catégories du prestataire. */
export function equipmentOptions(categories: string[]): { category: string; options: string[] }[] {
  const seen = new Set<string>();
  return categories.map((c) => ({ category: c, options: profile(c).equipment.filter((o) => !seen.has(o) && seen.add(o)) })).filter((g) => g.options.length > 0);
}

/** Toutes les clés de capacité connues (lecture des capacités enregistrées). */
export const ALL_CAPACITY_KEYS = [...new Set(Object.values(SUPPLIER_PROFILES).flatMap((p) => p.capacities.map((f) => f.key)))];
/** Libellé après le nombre (« 120 places en théâtre »). */
export const capacityUnit = (key: string) => Object.values(SUPPLIER_PROFILES).flatMap((p) => p.capacities).find((f) => f.key === key)?.unit ?? key;

/** Questions de la demande de devis propres à une catégorie. */
export const detailFields = (category: string) => profile(category).details;

/** Lecture des réponses du formulaire (préfixe « d_ ») : uniquement les champs de la catégorie, valeurs bornées. */
export function readDetails(category: string, form: FormData): Record<string, string | string[]> {
  const out: Record<string, string | string[]> = {};
  for (const f of detailFields(category)) {
    if (f.kind === "multi") {
      const v = form.getAll(`d_${f.key}`).map(String).filter((x) => f.options.some((o) => o.id === x));
      if (v.length) out[f.key] = v;
      continue;
    }
    const v = String(form.get(`d_${f.key}`) ?? "").trim();
    if (!v) continue;
    if (f.kind === "choice" && !f.options.some((o) => o.id === v)) continue;
    if (f.kind === "number" && !(Number.isFinite(Number(v)) && Number(v) >= 0 && Number(v) < 10_000_000)) continue;
    if (f.kind === "date" && !/^\d{4}-\d{2}-\d{2}$/.test(v)) continue;
    if (f.kind === "time" && !/^\d{2}:\d{2}$/.test(v)) continue;
    out[f.key] = v.slice(0, f.kind === "text" ? 2000 : 40);
  }
  return out;
}

/** Réponses lisibles (libellé, valeur) d'une demande, dans l'ordre des questions ; la date est rendue par `fmtDay`. */
export function detailLines(category: string, raw: unknown, fmtDay: (iso: string) => string = (d) => d): { label: string; value: string; translate: boolean }[] {
  const d = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const lines: { label: string; value: string; translate: boolean }[] = [];
  for (const f of detailFields(category)) {
    const v = d[f.key];
    if (v == null || v === "") continue;
    if (f.kind === "multi" && Array.isArray(v)) lines.push({ label: f.label, value: v.map((x) => f.options.find((o) => o.id === x)?.label ?? String(x)).join(", "), translate: true });
    else if (f.kind === "choice") lines.push({ label: f.label, value: f.options.find((o) => o.id === v)?.label ?? String(v), translate: true });
    else if (f.kind === "date") lines.push({ label: f.label, value: fmtDay(String(v)), translate: false });
    else lines.push({ label: f.label, value: String(v), translate: false });
  }
  return lines;
}

/** Catégories pour lesquelles le prestataire facture au nombre de personnes : il attend le nombre définitif. */
export const FINAL_COUNT_CATEGORIES = ["restauration", "hebergement", "transport", "salle"];
/** Délai usuel : le nombre définitif est demandé environ 10 jours avant (7 à 15 selon les traiteurs et les hôtels). */
export const FINAL_COUNT_DAYS = 10;

/** Prestations acceptées par les inscrits qui préfigurent le nombre définitif d'une catégorie. */
export const FINAL_COUNT_BENEFITS: Record<string, string[]> = {
  restauration: ["dejeuner", "cocktail", "cafe"],
  hebergement: ["nuitee"],
  transport: ["transport"],
};

/** Conditions structurées d'un devis : acompte et barème d'annulation. */
export type QuoteTerms = { depositPct: number | null; cancelFreeDays: number | null; cancelMidPct: number | null; cancelFullDays: number | null };

const intIn = (v: FormDataEntryValue | null, min: number, max: number) => {
  const s = String(v ?? "").trim();
  if (!s) return null;
  const n = Number(s);
  return Number.isInteger(n) && n >= min && n <= max ? n : undefined;
};

/** Lecture des conditions : undefined en cas de valeur hors bornes (erreur), null si non renseignée. */
export function readQuoteTerms(form: FormData): QuoteTerms | { error: string } {
  const depositPct = intIn(form.get("depositPct"), 0, 100);
  const cancelFreeDays = intIn(form.get("cancelFreeDays"), 0, 365);
  const cancelMidPct = intIn(form.get("cancelMidPct"), 0, 100);
  const cancelFullDays = intIn(form.get("cancelFullDays"), 0, 365);
  if ([depositPct, cancelFreeDays, cancelMidPct, cancelFullDays].some((v) => v === undefined)) return { error: "Conditions invalides : pourcentages de 0 à 100, délais de 0 à 365 jours." };
  if (cancelFreeDays != null && cancelFullDays != null && cancelFullDays > cancelFreeDays) return { error: "Barème d'annulation incohérent : la totalité ne peut être due plus tôt que la fin de l'annulation sans frais." };
  return { depositPct: depositPct ?? null, cancelFreeDays: cancelFreeDays ?? null, cancelMidPct: cancelMidPct ?? null, cancelFullDays: cancelFullDays ?? null };
}

/** Conditions en clair (clés à traduire avec leurs variables), dans l'ordre : acompte, puis barème d'annulation. */
export function termsParts(q: QuoteTerms): { key: string; vars: Record<string, number> }[] {
  const out: { key: string; vars: Record<string, number> }[] = [];
  if (q.depositPct) out.push({ key: "acompte de {pct} %", vars: { pct: q.depositPct } });
  if (q.cancelFreeDays != null) out.push({ key: "annulation sans frais jusqu'à J-{days}", vars: { days: q.cancelFreeDays } });
  if (q.cancelMidPct != null && q.cancelFreeDays != null) out.push(q.cancelFullDays != null ? { key: "{pct} % dus de J-{from} à J-{to}", vars: { pct: q.cancelMidPct, from: q.cancelFreeDays, to: q.cancelFullDays } } : { key: "{pct} % dus après J-{from}", vars: { pct: q.cancelMidPct, from: q.cancelFreeDays } });
  if (q.cancelFullDays != null) out.push({ key: "totalité due à moins de J-{days}", vars: { days: q.cancelFullDays } });
  return out;
}
