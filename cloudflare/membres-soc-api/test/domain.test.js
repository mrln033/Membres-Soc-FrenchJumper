import test from "node:test";
import assert from "node:assert/strict";
import { getMemberTransition, normalizeAvatarName, parseEffectiveDate } from "../src/domain.js";

const grades = [
  { id: "former", name: "Ancien Membre", level: 0 },
  { id: "traveler", name: "Voyageur", level: 1 },
  { id: "experienced-traveler", name: "Voyageur Expérimenté", level: 2 },
  { id: "adventurer", name: "Aventurier", level: 3 },
  { id: "experienced-adventurer", name: "Aventurier Expérimenté", level: 4 },
  { id: "advisor", name: "Conseiller d'Expédition", level: 5 },
  { id: "chief", name: "Chef d'Expédition", level: 6 }
];

test("normalise les noms comme GAS", () => {
  assert.equal(normalizeAvatarName("  Merlin   Merzhin  LeSage "), "merlin merzhin lesage");
});

test("convertit une date française en date D1 locale", () => {
  assert.equal(parseEffectiveDate("12-08-2026 17:05"), "2026-08-12T17:05:00");
  assert.throws(() => parseEffectiveDate("31-02-2026 12:00"), /invalide/);
});

test("reproduit les transitions GAS", () => {
  assert.equal(getMemberTransition("ENTREE", grades[0], grades).newGrade.name, "Voyageur");
  assert.equal(getMemberTransition("PROMOTION", grades[1], grades).newGrade.name, "Voyageur Expérimenté");
  assert.equal(getMemberTransition("RETROGRADATION", grades[3], grades).newGrade.name, "Voyageur Expérimenté");
  assert.equal(getMemberTransition("SORTIE", grades[3], grades).newGrade.name, "Ancien Membre");
  assert.throws(() => getMemberTransition("PROMOTION", grades[4], grades), /non autorisée/);
});
