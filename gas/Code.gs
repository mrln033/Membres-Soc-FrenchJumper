function onEdit(e) {
   const sheet = e.range.getSheet();
   
  // Sécurité : ignorer les entêtes
  if (e.range.getRow() < 2) return;
     
  // Si modification en colonne B (colonne 2)
  if (e.range.getColumn() === 2) {
    const uuidCell = sheet.getRange(e.range.getRow(), 1); // colonne A
      
    // Si la cellule A est vide
    if (!uuidCell.getValue()) {
      uuidCell.setValue(Utilities.getUuid());
    }
  }
}

function getConfig(){
  return {
    BOT_TOKEN: PropertiesService.getScriptProperties().getProperty("BOT_TOKEN"),
    BOT_ID: PropertiesService.getScriptProperties().getProperty("BOT_ID"),
    BOT_KEY: PropertiesService.getScriptProperties().getProperty("BOT_KEY"),
    GUILD_ID: PropertiesService.getScriptProperties().getProperty("GUILD_ID")
  };
}

function doGet(e) {
  const action = e.parameter.action;

  if (action === "getMembres") {
    return getMembres();
  }

  if (action === "getMouvements") {  // <-- nouvel endpoint
    return getMouvements();
  }

  if (action === "getMouvementsMensuels") {
    return getMouvementsMensuels();
  }

  if (action === "getFiche") {
    return getFiche(e.parameter.id);
  }

  return ContentService
    .createTextOutput(JSON.stringify({ error: "unknown action" }))
    .setMimeType(ContentService.MimeType.JSON);
}

function doPost(e) {
  if (!e || !e.postData || !e.postData.contents) {
    return ContentService
      .createTextOutput(JSON.stringify({ success:false, error:"Aucune donnée reçue" }))
      .setMimeType(ContentService.MimeType.JSON);
  }

  let data;
  try {
    data = JSON.parse(e.postData.contents);
  } catch (err) {
    return ContentService
      .createTextOutput(JSON.stringify({ success:false, error:"JSON invalide : " + err.message }))
      .setMimeType(ContentService.MimeType.JSON);
  }

  // Cas ping Discord
  if (data.type === 1) {
    return ContentService
      .createTextOutput(JSON.stringify({ type: 1 }))
      .setMimeType(ContentService.MimeType.JSON);
  }

  // Commande slash /sync-frj depuis Discord
  if (data.data && data.data.name === "sync-frj") {
    const user = data.data.options?.[0]?.user;
    if (!user) {
      return ContentService.createTextOutput(JSON.stringify({
        type: 4,
        data: { content: "Erreur : utilisateur non fourni" }
      })).setMimeType(ContentService.MimeType.JSON);
    }
    const discordId = user.id;
    const nick = user.username;
    const nomAvatar = nick;

    syncFRJ(nomAvatar, discordId, nick);

    return ContentService.createTextOutput(JSON.stringify({
      type: 4,
      data: { content: "⌛ Synchronisation en cours..." }
    })).setMimeType(ContentService.MimeType.JSON);
  }

  // Cas front web
  if (data.action === "syncDiscordFromWeb") {
    return syncDiscordFromWeb(data);
  }

  if (data.action === "applyMembreAction") {
    return applyMembreAction(data);
  }

  // Cas par défaut
  return ContentService
    .createTextOutput(JSON.stringify({ success:false, error:"Action inconnue" }))
    .setMimeType(ContentService.MimeType.JSON);
}

function getMembres() {

  const ss = SpreadsheetApp.getActive();

  const sheetM = ss.getSheetByName("MEMBRES_SOC");
  const sheetG = ss.getSheetByName("GRADES");
  const sheetH = ss.getSheetByName("HISTORIQUE_MOUVEMENTS");

  const membres = sheetM.getDataRange().getValues();
  const grades = sheetG.getDataRange().getValues();
  const mouvements = sheetH.getDataRange().getValues();

  const mapM = getColumnMap(sheetM);
  const mapG = getColumnMap(sheetG);
  const mapH = getColumnMap(sheetH);

  const gradeMap = {};

  for (let i = 1; i < grades.length; i++) {

    const id = grades[i][mapG["GradeID"]];

    gradeMap[id] = {
      nom: grades[i][mapG["NomGrade"]],
      niveau: Number(grades[i][mapG["Niveau"]])
    };

  }

  // -----------------------------
  // Analyse des mouvements ENTREE
  // -----------------------------

  const entreeMap = {};

  for (let i = 1; i < mouvements.length; i++) {

    const type = mouvements[i][mapH["TypeMouvement"]];

    if (type !== "ENTREE") continue;

    const membreId = mouvements[i][mapH["MembreID"]];
    const dateEff = mouvements[i][mapH["DateEffective"]];

    if (!entreeMap[membreId]) {

      entreeMap[membreId] = {
        lastDate: dateEff,
        count: 1
      };

    } else {

      entreeMap[membreId].count++;

      if (new Date(dateEff) > new Date(entreeMap[membreId].lastDate)) {
        entreeMap[membreId].lastDate = dateEff;
      }

    }

  }

  // -----------------------------
  // Construction résultat
  // -----------------------------

  const result = [];

  for (let i = 1; i < membres.length; i++) {

    const membreId = membres[i][mapM["MembreID"]];
    const gradeId = membres[i][mapM["GradeID"]];
    const grade = gradeMap[gradeId];

    if (!grade) continue;

    let date = "";
    let entreeCount = 0;

    const entree = entreeMap[membreId];

    if (entree) {

      entreeCount = entree.count;

      date = Utilities.formatDate(
        new Date(entree.lastDate),
        Session.getScriptTimeZone(),
        "dd/MM/yyyy"
      );

    }

    result.push({
      id: membreId,
      nom: membres[i][mapM["NomAvatar"]],
      date: date,
      entreeCount: entreeCount,
      regleSoc: membres[i][mapM["RegleSoc"]],
      IDDiscord: membres[i][mapM["IDDiscord"]],
      grade: grade.nom,
      niveau: grade.niveau
    });

  }

  return ContentService
    .createTextOutput(JSON.stringify(result))
    .setMimeType(ContentService.MimeType.JSON);

}

function getColumnMap(sheet) {

  const headers = sheet.getRange(1,1,1,sheet.getLastColumn()).getValues()[0];
  const map = {};

  headers.forEach((h,i) => {
    map[h] = i;
  });

  return map;
}


function getMouvements() {
  const ss = SpreadsheetApp.getActive();
  const sheetH = ss.getSheetByName("HISTORIQUE_MOUVEMENTS");

  const data = sheetH.getDataRange().getValues();
  const headers = data[0];

  const result = [];

  for (let i = 1; i < data.length; i++) {
    const rowObj = {};
    headers.forEach((h, j) => {
      rowObj[h] = data[i][j];
    });
    result.push(rowObj);
  }

  return ContentService
    .createTextOutput(JSON.stringify(result))
    .setMimeType(ContentService.MimeType.JSON);
}





function syncFRJ(nomAvatar, discordId, nick) {
  const SHEET_ID = "1zLPKU-rfIU2tPnvnCaRwCC87MqOpOZ2EXjs9ANDBDBs";
  const SHEET_NAME = "MEMBRES_SOC";

  const ss = SpreadsheetApp.openById(SHEET_ID);
  const sheet = ss.getSheetByName(SHEET_NAME);

  // Lecture uniquement de l'entête pour retrouver les index
  const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
  const idxNomAvatar = headers.indexOf("NomAvatar");
  const idxIDDiscord = headers.indexOf("IDDiscord");

  if (idxNomAvatar === -1 || idxIDDiscord === -1) {
    return "Erreur : colonnes NomAvatar ou IDDiscord non trouvées.";
  }

  // Lecture des données
  const values = sheet.getRange(2, 1, sheet.getLastRow()-1, headers.length).getValues();

  // Recherche du membre
  for (let i = 0; i < values.length; i++) {
    if (values[i][idxNomAvatar] === nomAvatar) {
      // Mise à jour IDDiscord
      sheet.getRange(i + 2, idxIDDiscord + 1).setValue(discordId);
      return `✅ Synchronisation réussie pour ${nomAvatar} (Discord : ${nick})`;
    }
  }

  // Si pas trouvé
  return `⚠️ Membre introuvable : ${nomAvatar}`;
}


function getFiche(membreId) {

  const ss = SpreadsheetApp.getActive();

  const sheetM = ss.getSheetByName("MEMBRES_SOC");
  const sheetG = ss.getSheetByName("GRADES");
  const sheetH = ss.getSheetByName("HISTORIQUE_MOUVEMENTS");

  const membres = sheetM.getDataRange().getValues();
  const grades = sheetG.getDataRange().getValues();
  const mouvements = sheetH.getDataRange().getValues();

  const mapM = getColumnMap(sheetM);
  const mapG = getColumnMap(sheetG);
  const mapH = getColumnMap(sheetH);

  // -------------------------
  // Map des grades
  // -------------------------
  const gradeMap = {};
  for (let i = 1; i < grades.length; i++) {
    const id = grades[i][mapG["GradeID"]];
    gradeMap[id] = {
      nom: grades[i][mapG["NomGrade"]],
      niveau: grades[i][mapG["Niveau"]]
    };
  }

  // -------------------------
  // MEMBRE
  // -------------------------
  let membre = null;

  for (let i = 1; i < membres.length; i++) {
    if (membres[i][mapM["MembreID"]] === membreId) {
      const gradeId = membres[i][mapM["GradeID"]];
      const grade = gradeMap[gradeId];

      membre = {
        id: membreId,
        nom: membres[i][mapM["NomAvatar"]],
        datePremiere: membres[i][mapM["DatePremiereEntree"]],
        nomDiscord: membres[i][mapM["NomDiscord"]],
        IDDiscord: membres[i][mapM["IDDiscord"]],
        regleSoc: membres[i][mapM["RegleSoc"]],
        grade: grade ? grade.nom : "",
        niveau: grade ? grade.niveau : ""
      };
      break;
    }
  }

  // -------------------------
  // HISTORIQUE
  // -------------------------
  const historique = [];

  for (let i = 1; i < mouvements.length; i++) {

    if (mouvements[i][mapH["MembreID"]] !== membreId) continue;

    const gradeId = mouvements[i][mapH["NouveauGradeID"]];
    const grade = gradeMap[gradeId];

    historique.push({
      date: mouvements[i][mapH["DateEffective"]],
      type: mouvements[i][mapH["TypeMouvement"]],
      grade: grade ? grade.nom : "", // nouveau grade en clair
      commentaire: mouvements[i][mapH["Commentaire"]]
    });
  }

  // tri DESC
  historique.sort((a, b) => new Date(b.date) - new Date(a.date));

  return ContentService
    .createTextOutput(JSON.stringify({
      membre: membre,           // null si pas trouvé
      historique: historique
    }))
    .setMimeType(ContentService.MimeType.JSON);

}


function importExMembresTest() {

  const SPREADSHEET_ID = "1zLPKU-rfIU2tPnvnCaRwCC87MqOpOZ2EXjs9ANDBDBs";
  const BATCH_SIZE = 100;

  const ss = SpreadsheetApp.openById(SPREADSHEET_ID);

  const srcSheet = ss.getSheetByName("Les Membres");
  const socSheet = ss.getSheetByName("MEMBRES_SOC");
  const histSheet = ss.getSheetByName("HISTORIQUE_MOUVEMENTS");

  const srcData = srcSheet.getDataRange().getValues();
  const srcHeaders = srcData.shift();

  const socData = socSheet.getDataRange().getValues();
  const socHeaders = socData.shift();

  const histHeaders = histSheet.getRange(1,1,1,histSheet.getLastColumn()).getValues()[0];

  function mapCols(headers){
    const map = {};
    headers.forEach((h,i)=> map[h]=i);
    return map;
  }

  const SRC = mapCols(srcHeaders);
  const SOC = mapCols(socHeaders);
  const HIST = mapCols(histHeaders);

  function formatDate(d){
    if(!d) return "";
    return Utilities.formatDate(
      new Date(d),
      Session.getScriptTimeZone(),
      "dd/MM/yyyy HH:mm:ss"
    );
  }

  /* index Avatar → MembreID */
  const membresIndex = {};

  socData.forEach(r=>{
    const avatar = r[SOC["NomAvatar"]];
    const id = r[SOC["MembreID"]];
    if(avatar) membresIndex[avatar] = id;
  });

  let traitement = 0;

  for (let i = 0; i < srcData.length; i++) {

    if (traitement >= BATCH_SIZE) break;

    const row = srcData[i];

    if (row[SRC["Grade"]] !== "9. Ex-Membre") continue;
    if (row[SRC["Photo"]] !== "") continue;

    const avatar = row[SRC["Avatar"]];
    const entree = formatDate(row[SRC["Entrée Soc"]]);
    const sortie = formatDate(row[SRC["Sortie Soc"]]);

    let membreID = membresIndex[avatar];

    /* membre inexistant → création */
    if (!membreID) {

      membreID = Utilities.getUuid();

      const socRow = new Array(socHeaders.length).fill("");

      socRow[SOC["MembreID"]] = membreID;
      socRow[SOC["NomAvatar"]] = avatar;
      socRow[SOC["GradeID"]] = "8478700e-1600-4429-8066-2265e105fe84";
      socRow[SOC["DatePremiereEntree"]] = entree;
      socRow[SOC["DateCreationFiche"]] = entree;

      socSheet.appendRow(socRow);

      membresIndex[avatar] = membreID;
    }

    /* mouvement ENTREE */

    const histRow1 = new Array(histHeaders.length).fill("");

    histRow1[HIST["MouvementID"]] = Utilities.getUuid();
    histRow1[HIST["MembreID"]] = membreID;
    histRow1[HIST["DateHeureSaisie"]] = entree;
    histRow1[HIST["DateEffective"]] = entree;
    histRow1[HIST["TypeMouvement"]] = "ENTREE";
    histRow1[HIST["NouveauGradeID"]] = "eea478c0-3223-4d58-b256-59e1cc0e6600";
    histRow1[HIST["Commentaire"]] = "Voyageur";

    histSheet.appendRow(histRow1);

    /* mouvement SORTIE */

    const histRow2 = new Array(histHeaders.length).fill("");

    histRow2[HIST["MouvementID"]] = Utilities.getUuid();
    histRow2[HIST["MembreID"]] = membreID;
    histRow2[HIST["DateHeureSaisie"]] = sortie;
    histRow2[HIST["DateEffective"]] = sortie;
    histRow2[HIST["TypeMouvement"]] = "SORTIE";
    histRow2[HIST["NouveauGradeID"]] = "8478700e-1600-4429-8066-2265e105fe84";
    histRow2[HIST["Commentaire"]] = "Ancien Membre";

    histSheet.appendRow(histRow2);

    srcSheet.getRange(i + 2, SRC["Photo"] + 1).setValue(1);

    traitement++;
  }

  Logger.log("Lignes traitées : " + traitement);
}

function getMouvementsMensuels() {

  const ss = SpreadsheetApp.getActive();

  const sheetH = ss.getSheetByName("HISTORIQUE_MOUVEMENTS");
  const sheetM = ss.getSheetByName("MEMBRES_SOC");
  const sheetG = ss.getSheetByName("GRADES");

  const hist = sheetH.getDataRange().getValues();
  const membres = sheetM.getDataRange().getValues();
  const grades = sheetG.getDataRange().getValues();

  const mapH = getColumnMap(sheetH);
  const mapM = getColumnMap(sheetM);
  const mapG = getColumnMap(sheetG);

  const membreMap = {};
  const gradeMap = {};

  // -------------------------
  // Map membres
  // -------------------------
  for (let i = 1; i < membres.length; i++) {

    const id = membres[i][mapM["MembreID"]];
    const nom = membres[i][mapM["NomAvatar"]];

    membreMap[id] = nom;

  }

  // -------------------------
  // Map grades
  // -------------------------
  for (let i = 1; i < grades.length; i++) {

    const id = grades[i][mapG["GradeID"]];
    const nom = grades[i][mapG["NomGrade"]];

    gradeMap[id] = nom;

  }

  // -------------------------
  // Construction résultat
  // -------------------------
  const result = [];

  for (let i = 1; i < hist.length; i++) {

    const membreId = hist[i][mapH["MembreID"]];
    const type = hist[i][mapH["TypeMouvement"]];
    const date = hist[i][mapH["DateEffective"]];
    const gradeId = hist[i][mapH["NouveauGradeID"]];

    result.push({

      id: membreId,
      nom: membreMap[membreId] || "",
      type: type,
      date: date,
      grade: gradeMap[gradeId] || ""

    });

  }

  return ContentService
    .createTextOutput(JSON.stringify(result))
    .setMimeType(ContentService.MimeType.JSON);

}



function applyMembreAction(data) {
  try {
    const membreId = data.membreId;
    const actionType = data.membreAction;
    const dateEffective = parseDateEffective_(data.dateEffective);

    if (!membreId) {
      throw new Error("MembreID manquant");
    }

    if (!actionType) {
      throw new Error("Action membre manquante");
    }

    const ss = SpreadsheetApp.getActive();
    const sheetM = ss.getSheetByName("MEMBRES_SOC");
    const sheetG = ss.getSheetByName("GRADES");
    const sheetH = ss.getSheetByName("HISTORIQUE_MOUVEMENTS");

    const membres = sheetM.getDataRange().getValues();
    const grades = sheetG.getDataRange().getValues();
    const mapM = getColumnMap(sheetM);
    const mapG = getColumnMap(sheetG);
    const mapH = getColumnMap(sheetH);

    const gradeById = {};
    const gradeByName = {};
    const gradesByNiveau = {};

    for (let i = 1; i < grades.length; i++) {
      const grade = {
        id: grades[i][mapG["GradeID"]],
        nom: grades[i][mapG["NomGrade"]],
        niveau: Number(grades[i][mapG["Niveau"]])
      };

      gradeById[grade.id] = grade;
      gradeByName[grade.nom] = grade;
      gradesByNiveau[grade.niveau] = grade;
    }

    let membreRowIndex = -1;
    let membreRow = null;

    for (let i = 1; i < membres.length; i++) {
      if (membres[i][mapM["MembreID"]] === membreId) {
        membreRowIndex = i + 1;
        membreRow = membres[i];
        break;
      }
    }

    if (!membreRow) {
      throw new Error("Membre introuvable");
    }

    const ancienGradeId = membreRow[mapM["GradeID"]];
    const ancienGrade = gradeById[ancienGradeId];

    if (!ancienGrade) {
      throw new Error("Grade actuel introuvable");
    }

    const transition = getMembreActionTransition_(actionType, ancienGrade, gradeByName, gradesByNiveau);

    sheetM.getRange(membreRowIndex, mapM["GradeID"] + 1).setValue(transition.nouveauGrade.id);

    if (
      actionType === "ENTREE" &&
      mapM["DatePremiereEntree"] !== undefined &&
      !membreRow[mapM["DatePremiereEntree"]]
    ) {
      sheetM.getRange(membreRowIndex, mapM["DatePremiereEntree"] + 1).setValue(dateEffective);
    }

    const histHeaders = sheetH.getRange(1, 1, 1, sheetH.getLastColumn()).getValues()[0];
    const histRow = new Array(histHeaders.length).fill("");

    histRow[mapH["MouvementID"]] = Utilities.getUuid();
    histRow[mapH["MembreID"]] = membreId;
    histRow[mapH["DateHeureSaisie"]] = new Date();
    histRow[mapH["DateEffective"]] = dateEffective;
    histRow[mapH["TypeMouvement"]] = transition.typeMouvement;
    histRow[mapH["AncienGradeID"]] = ancienGrade.id;
    histRow[mapH["NouveauGradeID"]] = transition.nouveauGrade.id;
    histRow[mapH["Commentaire"]] = transition.commentaire;

    sheetH.appendRow(histRow);

    const membrePourDiscord = getMembreById(membreId);
    const syncDiscord = syncDiscordMembre_(membrePourDiscord);

    return ContentService.createTextOutput(JSON.stringify({
      success: true,
      ancienGrade: ancienGrade.nom,
      nouveauGrade: transition.nouveauGrade.nom,
      typeMouvement: transition.typeMouvement,
      syncDiscord: syncDiscord
    })).setMimeType(ContentService.MimeType.JSON);

  } catch (err) {
    return ContentService.createTextOutput(JSON.stringify({
      success: false,
      error: err.message
    })).setMimeType(ContentService.MimeType.JSON);
  }
}

function getMembreActionTransition_(actionType, ancienGrade, gradeByName, gradesByNiveau) {
  const ancienMembre = gradeByName["Ancien Membre"];
  const voyageur = gradeByName["Voyageur"];

  if (!ancienMembre || !voyageur) {
    throw new Error("Grades de base introuvables");
  }

  if (actionType === "ENTREE") {
    if (ancienGrade.nom !== "Ancien Membre") {
      throw new Error("Nouvelle entrée autorisée uniquement pour un ancien membre");
    }

    return {
      typeMouvement: "ENTREE",
      nouveauGrade: voyageur,
      commentaire: "Nouvelle entrée comme Voyageur"
    };
  }

  if (actionType === "SORTIE") {
    if (ancienGrade.nom === "Ancien Membre") {
      throw new Error("Sortie impossible pour un ancien membre");
    }

    if (ancienGrade.nom === "Chef d'Expédition") {
      throw new Error("Aucune action possible pour le Chef d'Expédition");
    }

    return {
      typeMouvement: "SORTIE",
      nouveauGrade: ancienMembre,
      commentaire: "Sortie vers Ancien Membre"
    };
  }

  if (actionType === "PROMOTION") {
    const nouveauGrade = gradesByNiveau[Number(ancienGrade.niveau) + 1];

    if (
      !nouveauGrade ||
      ancienGrade.nom === "Ancien Membre" ||
      ancienGrade.nom === "Aventurier Expérimenté" ||
      ancienGrade.nom === "Conseiller d'Expédition" ||
      ancienGrade.nom === "Chef d'Expédition"
    ) {
      throw new Error("Promotion non autorisée pour ce grade");
    }

    return {
      typeMouvement: "PROMOTION",
      nouveauGrade: nouveauGrade,
      commentaire: "Promotion vers " + nouveauGrade.nom
    };
  }

  if (actionType === "RETROGRADATION") {
    const nouveauGrade = gradesByNiveau[Number(ancienGrade.niveau) - 1];

    if (
      !nouveauGrade ||
      ancienGrade.nom === "Ancien Membre" ||
      ancienGrade.nom === "Voyageur" ||
      ancienGrade.nom === "Conseiller d'Expédition" ||
      ancienGrade.nom === "Chef d'Expédition"
    ) {
      throw new Error("Rétrogradation non autorisée pour ce grade");
    }

    return {
      typeMouvement: "RETROGRADATION",
      nouveauGrade: nouveauGrade,
      commentaire: "Rétrogradation vers " + nouveauGrade.nom
    };
  }

  throw new Error("Action membre inconnue");
}

function parseDateEffective_(value) {
  if (!value) {
    throw new Error("Date effective manquante");
  }

  const match = String(value).match(/^(\d{4})-(\d{2})-(\d{2})$/);

  if (!match) {
    throw new Error("Date effective invalide");
  }

  return new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]), 12, 0, 0);
}

function syncDiscordMembre_(membre) {
  try {
    if (!membre) {
      return {
        success: false,
        error: "Membre introuvable"
      };
    }

    if (!membre.discordId) {
      return {
        success: false,
        error: "ID Discord manquant pour ce membre"
      };
    }

    const response = UrlFetchApp.fetch(
      "https://discord-proxy.merlin-merzhin-lesage.workers.dev/sync",
      {
        method: "POST",
        contentType: "application/json",
        payload: JSON.stringify({
          discordId: membre.discordId,
          nomAvatar: membre.nomAvatar,
          niveau: membre.niveau,
          secret: "12062006"
        }),
        muteHttpExceptions: true
      }
    );

    const result = JSON.parse(response.getContentText());

    if (result.success) {
      return {
        success: true,
        message: "Synchronisation envoyée pour " + membre.nomAvatar
      };
    }

    return {
      success: false,
      error: result.error || "Erreur inconnue côté Worker"
    };

  } catch (err) {
    return {
      success: false,
      error: err.message
    };
  }
}

function syncDiscordFromWeb(data) {
  try {

    const membreId = data.membreId;

    // Récupération du membre
    const membre = getMembreById(membreId);

    if (!membre) {
      return ContentService.createTextOutput(JSON.stringify({
        success: false,
        error: "Membre introuvable"
      })).setMimeType(ContentService.MimeType.JSON);
    }

    if (!membre.discordId) {
      return ContentService.createTextOutput(JSON.stringify({
        success: false,
        error: "ID Discord manquant pour ce membre"
      })).setMimeType(ContentService.MimeType.JSON);
    }

    // Appel vers Worker Cloudflare
    const response = UrlFetchApp.fetch(
      "https://discord-proxy.merlin-merzhin-lesage.workers.dev/sync",
      {
        method: "POST",
        contentType: "application/json",
        payload: JSON.stringify({
          discordId: membre.discordId,
          nomAvatar: membre.nomAvatar,
          niveau: membre.niveau,
          secret: "12062006"
        }),
        muteHttpExceptions: true
      }
    );

    const result = JSON.parse(response.getContentText());


    if (result.success) {
      return ContentService.createTextOutput(JSON.stringify({
        success: true,
        message: `✅ Synchronisation envoyée pour ${membre.nomAvatar}`
      })).setMimeType(ContentService.MimeType.JSON);
    } else {
      return ContentService.createTextOutput(JSON.stringify({
        success: false,
        error: result.error || "Erreur inconnue côté Worker"
      })).setMimeType(ContentService.MimeType.JSON);
    }

  } catch (err) {
    return ContentService.createTextOutput(JSON.stringify({
      success: false,
      error: err.message
    })).setMimeType(ContentService.MimeType.JSON);
  }
}

function getMembreById(membreId) {
  const ss = SpreadsheetApp.getActive();
  const sheetM = ss.getSheetByName("MEMBRES_SOC");
  const sheetG = ss.getSheetByName("GRADES");

  const membres = sheetM.getDataRange().getValues();
  const grades = sheetG.getDataRange().getValues();

  const mapM = getColumnMap(sheetM);
  const mapG = getColumnMap(sheetG);

  let membre = null;

  for (let i = 1; i < membres.length; i++) {
    if (membres[i][mapM["MembreID"]] === membreId) {
      const gradeId = membres[i][mapM["GradeID"]];
      const grade = grades.find(g => g[mapG["GradeID"]] === gradeId);

      membre = {
        membreId: membreId,
        nomAvatar: membres[i][mapM["NomAvatar"]],
        discordId: membres[i][mapM["IDDiscord"]],
        niveau: grade ? Number(grade[mapG["Niveau"]]) : 0
      };
      break;
    }
  }

  return membre;
}
