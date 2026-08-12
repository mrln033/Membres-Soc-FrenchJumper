export const EXIT_TYPES = new Set(["SORTIE", "DESERTION", "BANNISSEMENT"]);

export function normalizeAvatarName(value) {
  return String(value || "").trim().replace(/\s+/g, " ").toLowerCase();
}

export function parseEffectiveDate(value) {
  const raw = String(value || "").trim().replace(/\s+/g, " ");
  const match = raw.match(/^(\d{2})[-/](\d{2})[-/](\d{4}) (\d{2}):(\d{2})(?::(\d{2}))?$/);
  if (!match) throw new Error(`Date effective invalide : ${raw || "valeur vide"}`);

  const [, day, month, year, hours, minutes, seconds = "00"] = match;
  const parts = [year, month, day, hours, minutes, seconds].map(Number);
  const [y, m, d, h, min, s] = parts;
  const date = new Date(Date.UTC(y, m - 1, d, h, min, s));
  if (
    date.getUTCFullYear() !== y || date.getUTCMonth() !== m - 1 || date.getUTCDate() !== d ||
    date.getUTCHours() !== h || date.getUTCMinutes() !== min || date.getUTCSeconds() !== s
  ) {
    throw new Error(`Date effective invalide : ${raw}`);
  }
  return `${year}-${month}-${day}T${hours}:${minutes}:${seconds}`;
}

export function getMemberTransition(actionType, currentGrade, grades) {
  const byName = new Map(grades.map((grade) => [grade.name, grade]));
  const byLevel = new Map(grades.map((grade) => [Number(grade.level), grade]));
  const former = byName.get("Ancien Membre");
  const traveler = byName.get("Voyageur");
  if (!former || !traveler) throw new Error("Grades de base introuvables");

  if (actionType === "ENTREE") {
    if (currentGrade.name !== "Ancien Membre") {
      throw new Error("Nouvelle entrée autorisée uniquement pour un ancien membre");
    }
    return { movementType: "ENTREE", newGrade: traveler, comment: "Nouvelle entrée comme Voyageur" };
  }

  if (EXIT_TYPES.has(actionType)) {
    if (currentGrade.name === "Ancien Membre") throw new Error("Sortie impossible pour un ancien membre");
    if (currentGrade.name === "Chef d'Expédition") throw new Error("Aucune action possible pour le Chef d'Expédition");
    if (actionType === "DESERTION" && currentGrade.name !== "Voyageur") {
      throw new Error("Désertion autorisée uniquement pour un Voyageur");
    }
    const comments = {
      DESERTION: "Désertion vers Ancien Membre",
      BANNISSEMENT: "Bannissement vers Ancien Membre",
      SORTIE: "Sortie vers Ancien Membre"
    };
    return { movementType: actionType, newGrade: former, comment: comments[actionType] };
  }

  if (actionType === "PROMOTION") {
    const newGrade = byLevel.get(Number(currentGrade.level) + 1);
    if (!newGrade || ["Ancien Membre", "Aventurier Expérimenté", "Conseiller d'Expédition", "Chef d'Expédition"].includes(currentGrade.name)) {
      throw new Error("Promotion non autorisée pour ce grade");
    }
    return { movementType: "PROMOTION", newGrade, comment: `Promotion vers ${newGrade.name}` };
  }

  if (actionType === "RETROGRADATION") {
    const newGrade = byLevel.get(Number(currentGrade.level) - 1);
    if (!newGrade || ["Ancien Membre", "Voyageur", "Conseiller d'Expédition", "Chef d'Expédition"].includes(currentGrade.name)) {
      throw new Error("Rétrogradation non autorisée pour ce grade");
    }
    return { movementType: "RETROGRADATION", newGrade, comment: `Rétrogradation vers ${newGrade.name}` };
  }

  throw new Error("Action membre inconnue");
}
