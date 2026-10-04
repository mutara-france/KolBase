"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";

const str = (f: FormData, k: string) => String(f.get(k) ?? "").trim();

/** Suivre / ne plus suivre un expert (type=practitioner) ou une organisation (type=organization). */
export async function toggleFollow(form: FormData) {
  const type = str(form, "type") === "organization" ? "organization" : "practitioner";
  const id = str(form, "id");
  const back = type === "organization" ? `/structures/${id}` : `/experts/${id}`;
  const user = await getCurrentUser();
  if (!user) redirect(`/connexion?next=${encodeURIComponent(back)}`);

  const where = type === "organization" ? { userId_organizationId: { userId: user.id, organizationId: id } } : { userId_practitionerId: { userId: user.id, practitionerId: id } };
  const existing = await db.follow.findUnique({ where });
  if (existing) {
    await db.follow.delete({ where: { id: existing.id } });
  } else {
    const target = type === "organization"
      ? await db.organization.findFirst({ where: { id, listed: true } })
      : await db.practitionerProfile.findFirst({ where: { id, listed: true, NOT: { userId: user.id } } });
    if (!target) return;
    await db.follow.create({ data: { userId: user.id, ...(type === "organization" ? { organizationId: id } : { practitionerId: id }) } });
  }
  revalidatePath(back);
  revalidatePath("/suivis");
}
