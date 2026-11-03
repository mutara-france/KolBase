import { startFakes, ENTREPRISES, mails } from "../e2e/faux-services.mjs";
import fs from "node:fs";
// Entrées supplémentaires du faux répertoire pour les scénarios.
ENTREPRISES["399951037"] = { siren: "399951037", nom_complet: "INSTITUT STRAUMANN FRANCE (fictif test)", etat_administratif: "A", siege: { libelle_commune: "MARNE-LA-VALLEE" } };
startFakes();
setInterval(() => fs.writeFileSync("/home/claude/kb-tests/mails.json", JSON.stringify(mails, null, 1)), 1000);
console.log("faux services prêts");
