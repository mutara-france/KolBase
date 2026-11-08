/**
 * Liste collée par l'organisateur : une personne par ligne, « e-mail ; prénom ; nom » (virgule, point-virgule ou
 * tabulation), ou « Prénom Nom <e-mail> ». Adresses dédoublonnées, lignes illisibles renvoyées.
 */
export function parseInviteList(text: string): { people: { email: string; firstName: string | null; lastName: string | null }[]; rejected: string[] } {
  const people = new Map<string, { email: string; firstName: string | null; lastName: string | null }>();
  const rejected: string[] = [];
  const valid = (e: string) => /^[^\s@<>;,]+@[^\s@<>;,]+\.[a-z]{2,}$/i.test(e);
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    let email = "", first: string | null = null, last: string | null = null;
    const angle = line.match(/^(.*)<([^>]+)>\s*$/);
    if (angle) {
      email = angle[2].trim();
      const names = angle[1].trim().replace(/^"|"$/g, "").split(/\s+/).filter(Boolean);
      first = names[0] ?? null;
      last = names.slice(1).join(" ") || null;
    } else {
      const parts = line.split(/[;,\t]/).map((p) => p.trim());
      const at = parts.findIndex((p) => p.includes("@"));
      if (at >= 0) {
        email = parts[at];
        const rest = parts.filter((_, i) => i !== at).filter(Boolean);
        first = rest[0] ?? null;
        last = rest[1] ?? null;
      }
    }
    email = email.toLowerCase();
    if (!valid(email)) { rejected.push(line.slice(0, 120)); continue; }
    if (!people.has(email)) people.set(email, { email, firstName: first?.slice(0, 80) ?? null, lastName: last?.slice(0, 80) ?? null });
  }
  return { people: [...people.values()], rejected };
}
