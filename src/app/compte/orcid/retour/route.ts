import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { audit, requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { appUrl } from "@/lib/ics";
import { ORCID_RE, orcidOAuth } from "@/lib/orcid";

/** Retour d'ORCID : échange du code contre l'iD authentifié, enregistré comme vérifié. */
export async function GET(req: Request) {
  const user = await requireUser();
  const oauth = orcidOAuth();
  const p = user.practitioner;
  if (!p || !oauth) redirect("/compte");
  const url = new URL(req.url);
  const jar = await cookies();
  const expected = jar.get("kb_orcid_state")?.value;
  jar.delete({ name: "kb_orcid_state", path: "/compte/orcid" });
  const code = url.searchParams.get("code");
  if (!code || !expected || url.searchParams.get("state") !== expected) redirect("/compte?orcid=erreur");

  let orcid: string | null = null;
  try {
    const res = await fetch(`${oauth.base}/oauth/token`, {
      method: "POST",
      headers: { Accept: "application/json", "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ client_id: oauth.id, client_secret: oauth.secret, grant_type: "authorization_code", code, redirect_uri: `${appUrl()}/compte/orcid/retour` }),
      signal: AbortSignal.timeout(10000),
      cache: "no-store",
    });
    if (res.ok) orcid = ((await res.json()) as { orcid?: string }).orcid ?? null;
  } catch {
    orcid = null;
  }
  if (!orcid || !ORCID_RE.test(orcid)) redirect("/compte?orcid=erreur");
  // Un iD vérifié n'appartient qu'à un seul praticien.
  if (await db.practitionerProfile.findFirst({ where: { orcid, orcidVerified: true, NOT: { id: p.id } } })) redirect("/compte?orcid=pris");
  await db.practitionerProfile.update({ where: { id: p.id }, data: { orcid, orcidVerified: true } });
  await audit(user.id, "orcid.connect", "PractitionerProfile", p.id, { orcid });
  redirect("/compte?orcid=ok");
}
