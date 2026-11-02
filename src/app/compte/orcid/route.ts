import { randomBytes } from "node:crypto";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { appUrl } from "@/lib/ics";
import { orcidOAuth } from "@/lib/orcid";

/** Départ vers ORCID : le praticien se connecte à son compte ORCID pour prouver que l'iD est le sien. */
export async function GET() {
  const user = await requireUser();
  const oauth = orcidOAuth();
  if (!user.practitioner || !oauth) redirect("/compte");
  const state = randomBytes(16).toString("base64url");
  (await cookies()).set("kb_orcid_state", state, { httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax", path: "/compte/orcid", maxAge: 600 });
  const params = new URLSearchParams({ client_id: oauth.id, response_type: "code", scope: "/authenticate", redirect_uri: `${appUrl()}/compte/orcid/retour`, state });
  redirect(`${oauth.base}/oauth/authorize?${params}`);
}
