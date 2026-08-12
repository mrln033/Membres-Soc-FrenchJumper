const D1_SYNC_DEFAULT_URL_ = "https://frj-membres-soc-api.merlin-merzhin-lesage.workers.dev";
const SYNC_OUTBOX_SHEET_ = "SYNC_OUTBOX";
const SYNC_META_SHEET_ = "SYNC_META";

function setupBidirectionalSync() {
  ensureSyncSheets_();
  const handlers = ScriptApp.getProjectTriggers().map(function(trigger) {
    return trigger.getHandlerFunction();
  });
  if (handlers.indexOf("syncMemberManualEdit") === -1) {
    ScriptApp.newTrigger("syncMemberManualEdit")
      .forSpreadsheet(SpreadsheetApp.getActive())
      .onEdit()
      .create();
  }
  if (handlers.indexOf("flushSyncOutbox") === -1) {
    ScriptApp.newTrigger("flushSyncOutbox").timeBased().everyMinutes(10).create();
  }
  return "Synchronisation préparée. Définir SYNC_ENABLED=true après validation.";
}

function syncMemberManualEdit(e) {
  if (!e || !e.range || !isSyncEnabled_()) return;
  const sheet = e.range.getSheet();
  if (e.range.getRow() < 2) return;

  const map = getColumnMap(sheet);
  if (sheet.getName() === "MEMBRES_SOC") {
    const memberId = String(sheet.getRange(e.range.getRow(), map["MembreID"] + 1).getValue() || "").trim();
    if (memberId) enqueueGasMemberMutation_(memberId, null, "SHEET_MANUAL", "MANUAL_MEMBER_EDIT");
    return;
  }
  if (sheet.getName() === "HISTORIQUE_MOUVEMENTS") {
    const movementId = String(sheet.getRange(e.range.getRow(), map["MouvementID"] + 1).getValue() || "").trim();
    const memberId = String(sheet.getRange(e.range.getRow(), map["MembreID"] + 1).getValue() || "").trim();
    if (movementId && memberId) enqueueGasMemberMutation_(memberId, movementId, "SHEET_MANUAL", "MANUAL_MOVEMENT_EDIT");
  }
}

function enqueueGasMemberMutation_(memberId, movementId, source, operation) {
  if (!isSyncEnabled_()) return { accepted: false, disabled: true };
  try {
    const mutation = buildGasMutation_(memberId, movementId, source || "GAS", operation || "UPSERT");
    return deliverGasMutation_(mutation, true);
  } catch (err) {
    console.error("Préparation synchronisation GAS impossible : " + err.message);
    return { accepted: false, error: err.message };
  }
}

function buildGasMutation_(memberId, movementId, source, operation) {
  const payload = {
    member: getGasMemberSnapshot_(memberId),
    movement: movementId ? getGasMovementSnapshot_(movementId) : null
  };
  if (!payload.member) throw new Error("Membre introuvable pour synchronisation");
  if (movementId && !payload.movement) throw new Error("Mouvement introuvable pour synchronisation");

  return {
    id: Utilities.getUuid(),
    source: source,
    target: "D1",
    entityType: movementId ? "MEMBER_AND_MOVEMENT" : "MEMBER",
    entityId: memberId,
    operation: operation,
    changedAt: new Date().toISOString(),
    payload: payload
  };
}

function deliverGasMutation_(mutation, storeOnFailure) {
  const properties = PropertiesService.getScriptProperties();
  const syncSecret = properties.getProperty("SYNC_SHARED_SECRET");
  const syncUrl = properties.getProperty("D1_SYNC_URL") || D1_SYNC_DEFAULT_URL_;
  if (!syncSecret) throw new Error("Propriété Apps Script manquante : SYNC_SHARED_SECRET");

  try {
    const response = UrlFetchApp.fetch(syncUrl, {
      method: "post",
      contentType: "application/json",
      payload: JSON.stringify({
        action: "replicateFromGas",
        syncSecret: syncSecret,
        mutation: mutation
      }),
      muteHttpExceptions: true
    });
    const status = response.getResponseCode();
    const result = JSON.parse(response.getContentText() || "{}");
    if (status < 200 || status >= 300 || result.success !== true) {
      throw new Error(result.error || ("D1 HTTP " + status));
    }
    markGasMutationVersion_(mutation);
    return { accepted: true, mutationId: mutation.id, duplicate: result.duplicate === true };
  } catch (err) {
    if (storeOnFailure) appendSyncOutbox_(mutation, err.message);
    throw err;
  }
}

function flushSyncOutbox() {
  if (!isSyncEnabled_()) return;
  const sheets = ensureSyncSheets_();
  const sheet = sheets.outbox;
  if (sheet.getLastRow() < 2) return;
  const rows = sheet.getRange(2, 1, sheet.getLastRow() - 1, 7).getValues();

  for (let index = 0; index < rows.length; index++) {
    if (rows[index][4] === "APPLIED") continue;
    try {
      const mutation = JSON.parse(rows[index][1]);
      deliverGasMutation_(mutation, false);
      sheet.getRange(index + 2, 5, 1, 3).setValues([["APPLIED", Number(rows[index][5] || 0) + 1, ""]]);
    } catch (err) {
      sheet.getRange(index + 2, 5, 1, 3).setValues([["PENDING", Number(rows[index][5] || 0) + 1, String(err.message).slice(0, 1000)]]);
    }
  }
}

function replicateFromD1_(data) {
  const expected = PropertiesService.getScriptProperties().getProperty("SYNC_SHARED_SECRET");
  if (!expected || String(data.syncSecret || "") !== expected) {
    return syncJson_({ success: false, error: "Unauthorized" });
  }
  try {
    const mutation = data.mutation || {};
    if (!mutation.id || !mutation.entityId || !mutation.changedAt || !mutation.payload) {
      throw new Error("Mutation incomplète");
    }
    if (!shouldApplyGasMutation_(mutation)) {
      return syncJson_({ success: true, conflict: true, applied: false });
    }

    applyMemberSnapshotToGas_(mutation.payload.member);
    if (mutation.payload.movement) applyMovementSnapshotToGas_(mutation.payload.movement);
    markGasMutationVersion_(mutation);
    return syncJson_({ success: true, applied: true, conflict: false });
  } catch (err) {
    return syncJson_({ success: false, error: err.message });
  }
}

function getGasSyncSnapshot_(data) {
  const expected = PropertiesService.getScriptProperties().getProperty("SYNC_SHARED_SECRET");
  if (!expected || String(data.syncSecret || "") !== expected) {
    return syncJson_({ success: false, error: "Unauthorized" });
  }
  const ss = SpreadsheetApp.getActive();
  const members = ss.getSheetByName("MEMBRES_SOC");
  const movements = ss.getSheetByName("HISTORIQUE_MOUVEMENTS");
  return syncJson_({
    success: true,
    members: Math.max(0, members.getLastRow() - 1),
    movements: Math.max(0, movements.getLastRow() - 1),
    generatedAt: new Date().toISOString()
  });
}

function getGasMemberSnapshot_(memberId) {
  const ss = SpreadsheetApp.getActive();
  const sheet = ss.getSheetByName("MEMBRES_SOC");
  const values = sheet.getDataRange().getValues();
  const map = getColumnMap(sheet);
  for (let i = 1; i < values.length; i++) {
    if (String(values[i][map["MembreID"]]) !== String(memberId)) continue;
    return {
      id: String(values[i][map["MembreID"]]),
      avatarName: String(values[i][map["NomAvatar"]] || ""),
      gradeId: String(values[i][map["GradeID"]] || ""),
      firstEntryAt: syncIso_(values[i][map["DatePremiereEntree"]]),
      createdAt: syncIso_(values[i][map["DateCreationFiche"]]),
      updatedAt: new Date().toISOString(),
      discordName: String(values[i][map["NomDiscord"]] || ""),
      discordId: String(values[i][map["IDDiscord"]] || ""),
      onFrjServer: syncBoolean_(values[i][map["ServeurFRJ"]]),
      rulesAccepted: syncBoolean_(values[i][map["RegleSoc"]])
    };
  }
  return null;
}

function getGasMovementSnapshot_(movementId) {
  const ss = SpreadsheetApp.getActive();
  const sheet = ss.getSheetByName("HISTORIQUE_MOUVEMENTS");
  const values = sheet.getDataRange().getValues();
  const map = getColumnMap(sheet);
  for (let i = 1; i < values.length; i++) {
    if (String(values[i][map["MouvementID"]]) !== String(movementId)) continue;
    return {
      id: String(values[i][map["MouvementID"]]),
      memberId: String(values[i][map["MembreID"]]),
      recordedAt: syncIso_(values[i][map["DateHeureSaisie"]]),
      effectiveAt: syncIso_(values[i][map["DateEffective"]]),
      movementType: String(values[i][map["TypeMouvement"]] || ""),
      oldGradeId: String(values[i][map["AncienGradeID"]] || ""),
      newGradeId: String(values[i][map["NouveauGradeID"]] || ""),
      comment: String(values[i][map["Commentaire"]] || ""),
      managerId: map["GestionnaireID"] === undefined ? "" : String(values[i][map["GestionnaireID"]] || "")
    };
  }
  return null;
}

function applyMemberSnapshotToGas_(member) {
  if (!member || !member.id || !member.gradeId) throw new Error("Snapshot membre incomplet");
  const ss = SpreadsheetApp.getActive();
  const sheet = ss.getSheetByName("MEMBRES_SOC");
  const map = getColumnMap(sheet);
  const values = sheet.getDataRange().getValues();
  let row = -1;
  for (let i = 1; i < values.length; i++) {
    if (String(values[i][map["MembreID"]]) === String(member.id)) { row = i + 1; break; }
  }
  if (row === -1) {
    row = sheet.getLastRow() + 1;
    sheet.getRange(row, 1, 1, sheet.getLastColumn()).setValues([new Array(sheet.getLastColumn()).fill("")]);
  }
  setSyncCell_(sheet, row, map, "MembreID", member.id);
  setSyncCell_(sheet, row, map, "NomAvatar", member.avatarName);
  setSyncCell_(sheet, row, map, "GradeID", member.gradeId);
  setSyncCell_(sheet, row, map, "DatePremiereEntree", syncDate_(member.firstEntryAt));
  setSyncCell_(sheet, row, map, "DateCreationFiche", syncDate_(member.createdAt));
  setSyncCell_(sheet, row, map, "NomDiscord", member.discordName || "");
  setSyncCell_(sheet, row, map, "IDDiscord", member.discordId || "");
  setSyncCell_(sheet, row, map, "ServeurFRJ", member.onFrjServer === true);
  setSyncCell_(sheet, row, map, "RegleSoc", member.rulesAccepted === true);
}

function applyMovementSnapshotToGas_(movement) {
  const ss = SpreadsheetApp.getActive();
  const sheet = ss.getSheetByName("HISTORIQUE_MOUVEMENTS");
  const map = getColumnMap(sheet);
  const values = sheet.getDataRange().getValues();
  let targetRow = sheet.getLastRow() + 1;
  for (let i = 1; i < values.length; i++) {
    if (String(values[i][map["MouvementID"]]) === String(movement.id)) {
      targetRow = i + 1;
      break;
    }
  }
  const row = new Array(sheet.getLastColumn()).fill("");
  row[map["MouvementID"]] = movement.id;
  row[map["MembreID"]] = movement.memberId;
  row[map["DateHeureSaisie"]] = syncDate_(movement.recordedAt);
  row[map["DateEffective"]] = syncDate_(movement.effectiveAt);
  row[map["TypeMouvement"]] = movement.movementType;
  row[map["AncienGradeID"]] = movement.oldGradeId || "";
  row[map["NouveauGradeID"]] = movement.newGradeId || "";
  row[map["Commentaire"]] = movement.comment || "";
  if (map["GestionnaireID"] !== undefined) row[map["GestionnaireID"]] = movement.managerId || "";
  sheet.getRange(targetRow, 1, 1, row.length).setValues([row]);
}

function shouldApplyGasMutation_(mutation) {
  const sheets = ensureSyncSheets_();
  const rows = sheets.meta.getDataRange().getValues();
  for (let i = 1; i < rows.length; i++) {
    if (rows[i][0] !== mutation.entityType || String(rows[i][1]) !== String(mutation.entityId)) continue;
    const incoming = String(mutation.changedAt) + "|" + String(mutation.id);
    const current = String(rows[i][2]) + "|" + String(rows[i][3]);
    return incoming >= current;
  }
  return true;
}

function markGasMutationVersion_(mutation) {
  const sheets = ensureSyncSheets_();
  const rows = sheets.meta.getDataRange().getValues();
  for (let i = 1; i < rows.length; i++) {
    if (rows[i][0] === mutation.entityType && String(rows[i][1]) === String(mutation.entityId)) {
      sheets.meta.getRange(i + 1, 3, 1, 3).setValues([[mutation.changedAt, mutation.id, mutation.source]]);
      return;
    }
  }
  sheets.meta.appendRow([mutation.entityType, mutation.entityId, mutation.changedAt, mutation.id, mutation.source]);
}

function appendSyncOutbox_(mutation, error) {
  const sheet = ensureSyncSheets_().outbox;
  sheet.appendRow([mutation.id, JSON.stringify(mutation), new Date(), "D1", "PENDING", 0, String(error || "").slice(0, 1000)]);
}

function ensureSyncSheets_() {
  const ss = SpreadsheetApp.getActive();
  let outbox = ss.getSheetByName(SYNC_OUTBOX_SHEET_);
  if (!outbox) {
    outbox = ss.insertSheet(SYNC_OUTBOX_SHEET_);
    outbox.appendRow(["MutationID", "PayloadJSON", "CreatedAt", "Target", "Status", "Attempts", "LastError"]);
    outbox.hideSheet();
  }
  let meta = ss.getSheetByName(SYNC_META_SHEET_);
  if (!meta) {
    meta = ss.insertSheet(SYNC_META_SHEET_);
    meta.appendRow(["EntityType", "EntityID", "ChangedAt", "MutationID", "Source"]);
    meta.hideSheet();
  }
  return { outbox: outbox, meta: meta };
}

function isSyncEnabled_() {
  return PropertiesService.getScriptProperties().getProperty("SYNC_ENABLED") === "true";
}

function setSyncCell_(sheet, row, map, name, value) {
  if (map[name] !== undefined) sheet.getRange(row, map[name] + 1).setValue(value === null ? "" : value);
}

function syncBoolean_(value) {
  return value === true || String(value).toLowerCase() === "true";
}

function syncIso_(value) {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return isNaN(date.getTime()) ? String(value) : date.toISOString();
}

function syncDate_(value) {
  if (!value) return "";
  const date = new Date(value);
  return isNaN(date.getTime()) ? value : date;
}

function syncJson_(data) {
  return ContentService.createTextOutput(JSON.stringify(data)).setMimeType(ContentService.MimeType.JSON);
}
