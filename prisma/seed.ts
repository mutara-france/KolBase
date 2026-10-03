// Données de démonstration minimales (reprises du prototype).
import "dotenv/config";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../src/generated/prisma/client";

const db = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }) });

async function main() {
  const org = await db.organization.upsert({
    where: { id: "demo-dentalys" },
    update: {},
    create: {
      id: "demo-dentalys",
      name: "Dentalys Implants",
      kind: "INDUSTRIEL",
      sector: "Dispositifs médicaux",
      headquarters: "Lyon, France",
      size: "Structure de démonstration",
      areas: ["Implantologie", "Parodontologie", "Prothèse, CFAO"],
      listed: true,
    },
  });

  await db.user.upsert({
    where: { email: "ines.lambert@demo.kolbase.local" },
    update: {},
    create: {
      email: "ines.lambert@demo.kolbase.local",
      firstName: "Inès",
      lastName: "Lambert",
      practitioner: { create: { profession: "Chirurgien-dentiste", city: "Lyon", languages: ["fr"], listed: false } },
    },
  });

  const event = await db.event.upsert({
    where: { id: "demo-event-1" },
    update: {},
    create: {
      id: "demo-event-1",
      organizationId: org.id,
      title: "Soirée implantologie — cas cliniques",
      typeId: "soiree",
      startsAt: new Date(Date.now() + 30 * 864e5),
      city: "Lyon",
      capacity: 60,
      publishedAt: new Date(),
      benefits: {
        create: [
          { catalogId: "cafe", label: "Pause café", valueCents: 1200 },
          { catalogId: "cocktail", label: "Cocktail", valueCents: 4500 },
        ],
      },
    },
  });

  console.log(`Seed OK : ${org.name}, événement ${event.title}`);
}

main().finally(() => db.$disconnect());
