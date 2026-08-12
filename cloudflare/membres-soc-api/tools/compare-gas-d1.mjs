const [gasUrl, d1Url = "http://127.0.0.1:8787"] = process.argv.slice(2);
if (!gasUrl) throw new Error("Usage: compare-gas-d1.mjs <gas-url> [d1-url]");

async function request(base, action, data = {}) {
  const url = new URL(base);
  url.search = new URLSearchParams({ action, ...data });
  let lastError;
  for (let attempt = 1; attempt <= 4; attempt++) {
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(90_000) });
      if (!response.ok) throw new Error(`${url.host} répond ${response.status}`);
      return response.json();
    } catch (error) {
      lastError = error;
      if (attempt < 4) await new Promise((resolve) => setTimeout(resolve, attempt * 1_500));
    }
  }
  throw lastError;
}

function bool(value) {
  return value === true || String(value || "").trim().toUpperCase() === "TRUE";
}

function dateTime(value) {
  if (!value) return "";
  const timestamp = new Date(value).getTime();
  return Number.isNaN(timestamp) ? String(value) : String(timestamp);
}

function stable(value) {
  if (Array.isArray(value)) return `[${value.map(stable).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stable(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function compareByKey(left, right, key, normalize) {
  const leftMap = new Map(left.map((row) => [row[key], normalize(row)]));
  const rightMap = new Map(right.map((row) => [row[key], normalize(row)]));
  const keys = new Set([...leftMap.keys(), ...rightMap.keys()]);
  const mismatches = [];
  for (const itemKey of keys) {
    if (stable(leftMap.get(itemKey)) !== stable(rightMap.get(itemKey))) {
      mismatches.push({ key: itemKey, gas: leftMap.get(itemKey), d1: rightMap.get(itemKey) });
    }
  }
  return { gas: left.length, d1: right.length, mismatches: mismatches.length, examples: mismatches.slice(0, 5) };
}

const [gasMembers, d1Members, gasMovements, d1Movements, gasMonthly, d1Monthly] = await Promise.all([
  request(gasUrl, "getMembres"), request(d1Url, "getMembres"),
  request(gasUrl, "getMouvements"), request(d1Url, "getMouvements"),
  request(gasUrl, "getMouvementsMensuels"), request(d1Url, "getMouvementsMensuels")
]);

const members = compareByKey(gasMembers, d1Members, "id", (row) => ({
  id: row.id, nom: row.nom, date: row.date || "", entreeCount: Number(row.entreeCount || 0),
  regleSoc: bool(row.regleSoc), serveurFRJ: bool(row.serveurFRJ), IDDiscord: String(row.IDDiscord || ""),
  grade: row.grade, niveau: Number(row.niveau)
}));

const movements = compareByKey(gasMovements, d1Movements, "MouvementID", (row) => ({
  MouvementID: row.MouvementID, MembreID: row.MembreID,
  DateHeureSaisie: dateTime(row.DateHeureSaisie), DateEffective: dateTime(row.DateEffective),
  TypeMouvement: row.TypeMouvement, AncienGradeID: String(row.AncienGradeID || ""),
  NouveauGradeID: String(row.NouveauGradeID || ""), Commentaire: String(row.Commentaire || ""),
  GestionnaireID: String(row.GestionnaireID || "")
}));

const monthlyKey = (row, index) => `${row.id}|${dateTime(row.date)}|${row.type}|${index}`;
const monthlyGas = gasMonthly.map((row, index) => ({ ...row, _key: monthlyKey(row, index) }));
const monthlyD1 = d1Monthly.map((row, index) => ({ ...row, _key: monthlyKey(row, index) }));
const monthly = compareByKey(monthlyGas, monthlyD1, "_key", (row) => ({
  id: row.id, nom: row.nom, type: row.type, date: dateTime(row.date), grade: row.grade || ""
}));

const sampleIds = gasMembers.filter((row) => Number(row.niveau) > 0).slice(0, 5).map((row) => row.id);
let ficheMismatches = 0;
for (const id of sampleIds) {
  const [gas, d1] = await Promise.all([request(gasUrl, "getFiche", { id }), request(d1Url, "getFiche", { id })]);
  const normalizeFiche = (value) => ({
    membre: value.membre ? {
      id: value.membre.id, nom: value.membre.nom, datePremiere: dateTime(value.membre.datePremiere),
      nomDiscord: String(value.membre.nomDiscord || ""), IDDiscord: String(value.membre.IDDiscord || ""),
      regleSoc: bool(value.membre.regleSoc), serveurFRJ: bool(value.membre.serveurFRJ),
      grade: value.membre.grade, niveau: Number(value.membre.niveau)
    } : null,
    historique: (value.historique || []).map((row) => ({
      date: dateTime(row.date), type: row.type, grade: row.grade || "", commentaire: row.commentaire || ""
    }))
  });
  if (stable(normalizeFiche(gas)) !== stable(normalizeFiche(d1))) ficheMismatches++;
}

console.log(JSON.stringify({ members, movements, monthly, fiches: { tested: sampleIds.length, mismatches: ficheMismatches } }, null, 2));
if (members.mismatches || movements.mismatches || monthly.mismatches || ficheMismatches) process.exitCode = 1;
