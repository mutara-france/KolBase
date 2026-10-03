import { SiteHeader } from "@/components/SiteHeader";
import { ListingForm, PasswordForm, ProfileForm } from "@/components/AccountForms";
import { requireUser } from "@/lib/auth";

export const metadata = { title: "Mon compte — Kolbase" };

export default async function Page() {
  const user = await requireUser();
  const p = user.practitioner;
  return (
    <>
      <SiteHeader />
      <main className="narrow stack">
        <div>
          <h1>Mon compte</h1>
          <p className="muted">
            {p ? (p.listed ? "Praticien · expert référencé" : "Praticien · participant") : "Compte organisation"}
            {user.memberships.length > 0 && ` · ${user.memberships.map((m) => m.organization.name).join(", ")}`}
          </p>
        </div>
        {p && <ListingForm listed={p.listed} />}
        <ProfileForm
          user={{ firstName: user.firstName, lastName: user.lastName, email: user.email, phone: user.phone, locale: user.locale }}
          practitioner={p ? { profession: p.profession, rpps: p.rpps, city: p.city, specialty: p.specialty, listed: p.listed } : null}
        />
        <PasswordForm email={user.email} />
      </main>
    </>
  );
}
