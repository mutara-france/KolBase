import { redirect } from "next/navigation";
import { audit } from "@/lib/auth";
import { db } from "@/lib/db";
import { consumeToken, findToken } from "@/lib/tokens";

/** Lien reçu par e-mail : confirme l'adresse du compte. */
export async function GET(_: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const t = await findToken(token, "VERIFY_EMAIL");
  if (!t || !(await consumeToken(t.id, t.userId, "VERIFY_EMAIL"))) redirect("/compte?email=lien-invalide");
  if (!t.user.emailVerifiedAt) await db.user.update({ where: { id: t.userId }, data: { emailVerifiedAt: new Date() } });
  await audit(t.userId, "user.email_verified", "User", t.userId);
  redirect("/compte?email=confirme");
}
