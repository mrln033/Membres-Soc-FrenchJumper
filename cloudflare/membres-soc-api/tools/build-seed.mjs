import fs from "node:fs/promises";
import path from "node:path";
import { normalizeAvatarName } from "../src/domain.js";

const [inputPath = "seed/source-export.json", outputPath = "seed/initial.sql"] = process.argv.slice(2);
const source = JSON.parse(await fs.readFile(inputPath, "utf8"));

function records(rows) {
  const [headers, ...data] = rows;
  return data.map((row) => Object.fromEntries(headers.map((header, index) => [header, row[index] ?? null])));
}

function isoFromExcel(value) {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value === "string" && /^\d{4}-\d{2}-\d{2}/.test(value)) return value.replace(/Z$/, "");
  const serial = Number(value);
  if (!Number.isFinite(serial)) throw new Error(`Date Excel invalide : ${value}`);
  return new Date(Date.UTC(1899, 11, 30) + Math.round(serial * 86400000)).toISOString().replace(/Z$/, "");
}

function bool(value) {
  return value === true || value === 1 || String(value || "").trim().toUpperCase() === "TRUE" ? 1 : 0;
}

function sql(value) {
  if (value === null || value === undefined || value === "") return "NULL";
  if (typeof value === "number") return String(value);
  return `'${String(value).replaceAll("'", "''")}'`;
}

function insertChunks(table, columns, rows, size = 150) {
  const statements = [];
  for (let offset = 0; offset < rows.length; offset += size) {
    const chunk = rows.slice(offset, offset + size);
    statements.push(
      `INSERT OR REPLACE INTO ${table} (${columns.join(", ")}) VALUES\n` +
      chunk.map((row) => `  (${row.map(sql).join(", ")})`).join(",\n") + ";"
    );
  }
  return statements;
}

const grades = records(source.GRADES)
  .filter((row) => row.GradeID && row.NomGrade)
  .map((row) => [row.GradeID, row.NomGrade, Number(row.Niveau), bool(row.EstUnique)]);

const members = records(source.MEMBRES_SOC)
  .filter((row) => row.MembreID && row.NomAvatar && row.GradeID)
  .map((row) => [
    row.MembreID,
    row.NomAvatar,
    normalizeAvatarName(row.NomAvatar),
    row.GradeID,
    isoFromExcel(row.DatePremiereEntree),
    isoFromExcel(row.DateCreationFiche),
    isoFromExcel(row.DateMaj),
    row.NomDiscord,
    row.IDDiscord,
    bool(row.ServeurFRJ),
    bool(row.RegleSoc)
  ]);

const memberIds = new Set(members.map((row) => row[0]));
const gradeIds = new Set(grades.map((row) => row[0]));
const orphanMovements = [];
const movements = records(source.HISTORIQUE_MOUVEMENTS)
  .filter((row) => row.MouvementID && row.MembreID && row.DateEffective && row.TypeMouvement)
  .filter((row) => {
    const valid = memberIds.has(row.MembreID) && (!row.AncienGradeID || gradeIds.has(row.AncienGradeID)) && (!row.NouveauGradeID || gradeIds.has(row.NouveauGradeID));
    if (!valid) orphanMovements.push(row.MouvementID);
    return valid;
  })
  .map((row) => [
    row.MouvementID,
    row.MembreID,
    isoFromExcel(row.DateHeureSaisie),
    isoFromExcel(row.DateEffective),
    row.TypeMouvement,
    row.AncienGradeID,
    row.NouveauGradeID,
    row.Commentaire,
    row.GestionnaireID
  ]);

const statements = [
  "PRAGMA foreign_keys = ON;",
  "DELETE FROM movements;",
  "DELETE FROM members;",
  "DELETE FROM grades;",
  ...insertChunks("grades", ["id", "name", "level", "is_unique"], grades),
  ...insertChunks("members", ["id", "avatar_name", "normalized_avatar_name", "grade_id", "first_entry_at", "created_at", "updated_at", "discord_name", "discord_id", "on_frj_server", "rules_accepted"], members),
  ...insertChunks("movements", ["id", "member_id", "recorded_at", "effective_at", "movement_type", "old_grade_id", "new_grade_id", "comment", "manager_id"], movements)
];

await fs.mkdir(path.dirname(outputPath), { recursive: true });
await fs.writeFile(outputPath, statements.join("\n\n") + "\n");
console.log(JSON.stringify({ grades: grades.length, members: members.length, movements: movements.length, orphanMovements: orphanMovements.length }));
if (orphanMovements.length) console.warn(`Mouvements ignorés (références orphelines) : ${orphanMovements.length}`);
