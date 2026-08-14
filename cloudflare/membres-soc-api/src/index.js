import { EXIT_TYPES, getMemberTransition, normalizeAvatarName, parseEffectiveDate } from "./domain.js";
import { removeDiscordRole } from "./discord.js";
import {
  flushPendingMutations,
  getSyncStatus,
  handleSyncQueue,
  receiveGasMutation,
  recordD1Mutation,
  runSyncAudit,
  SyncError
} from "./sync.js";

const MAX_BODY_BYTES = 32_000;

export default {
  async fetch(request, env) {
    const origin = request.headers.get("Origin");

    if (request.method === "OPTIONS") return corsPreflight(origin, env);

    try {
      const url = new URL(request.url);

      if (url.pathname === "/health" && request.method === "GET") {
        const counts = await env.DB.prepare(`
          SELECT
            (SELECT COUNT(*) FROM grades) AS grades,
            (SELECT COUNT(*) FROM members) AS members,
            (SELECT COUNT(*) FROM movements) AS movements
        `).first();
        return withCors(json({ ok: true, ...counts }), origin, env);
      }

      if (request.method === "GET") {
        if (url.searchParams.get("action") === "getSyncStatus") {
          if (!(await isAuthorized(request, env.ADMIN_TOKEN))) {
            return withCors(json({ error: "Unauthorized" }, 401), origin, env);
          }
          return withCors(json(await getSyncStatus(env)), origin, env);
        }
        return withCors(await handleGet(url, env), origin, env);
      }

      if (request.method === "POST") {
        const data = await readJson(request);
        if (data.action === "replicateFromGas") {
          if (!(await isSyncAuthorized(data.syncSecret, env.SYNC_SHARED_SECRET))) {
            return withCors(json({ error: "Unauthorized" }, 401), origin, env);
          }
          return withCors(json(await receiveGasMutation(env, data)), origin, env);
        }
        if (!(await isAuthorized(request, env.ADMIN_TOKEN))) {
          return withCors(json({ error: "Unauthorized" }, 401), origin, env);
        }
        return withCors(await handlePost(data, env), origin, env);
      }

      return withCors(json({ error: "Method not allowed" }, 405), origin, env);
    } catch (error) {
      if (error instanceof ApiError || error instanceof SyncError) {
        return withCors(json({ error: error.message }, error.status), origin, env);
      }

      console.error(JSON.stringify({
        message: "Unhandled API error",
        method: request.method,
        path: new URL(request.url).pathname,
        error: error instanceof Error ? error.message : String(error)
      }));
      return withCors(json({ error: "Erreur interne" }, 500), origin, env);
    }
  },

  async queue(batch, env) {
    await handleSyncQueue(batch, env);
  },

  async scheduled(_controller, env) {
    await Promise.all([flushPendingMutations(env), runSyncAudit(env)]);
  }
};

async function handleGet(url, env) {
  const action = url.searchParams.get("action");

  if (action === "getMembres") {
    const result = await env.DB.prepare(`
      SELECT
        m.id,
        m.avatar_name AS nom,
        m.rules_accepted,
        m.on_frj_server,
        m.discord_id,
        g.name AS grade,
        g.level AS niveau,
        MAX(CASE WHEN mv.movement_type = 'ENTREE' THEN mv.effective_at END) AS last_entry,
        SUM(CASE WHEN mv.movement_type = 'ENTREE' THEN 1 ELSE 0 END) AS entry_count
      FROM members m
      JOIN grades g ON g.id = m.grade_id
      LEFT JOIN movements mv ON mv.member_id = m.id
      GROUP BY m.id
      ORDER BY m.avatar_name COLLATE NOCASE
    `).all();

    return publicJson(result.results.map((row) => ({
      id: row.id,
      nom: row.nom,
      date: formatFrenchDate(row.last_entry),
      entreeCount: Number(row.entry_count || 0),
      regleSoc: Boolean(row.rules_accepted),
      serveurFRJ: Boolean(row.on_frj_server),
      IDDiscord: row.discord_id || "",
      grade: row.grade,
      niveau: Number(row.niveau)
    })));
  }

  if (action === "getMouvements") {
    const result = await env.DB.prepare(`
      SELECT id, member_id, recorded_at, effective_at, movement_type,
             old_grade_id, new_grade_id, comment, manager_id
      FROM movements
      ORDER BY rowid
    `).all();
    return publicJson(result.results.map(toLegacyMovement));
  }

  if (action === "getMouvementsMensuels") {
    const result = await env.DB.prepare(`
      SELECT mv.member_id AS id, m.avatar_name AS nom, mv.movement_type AS type,
             mv.effective_at AS date, COALESCE(g.name, '') AS grade
      FROM movements mv
      JOIN members m ON m.id = mv.member_id
      LEFT JOIN grades g ON g.id = mv.new_grade_id
      ORDER BY mv.rowid
    `).all();
    return publicJson(result.results);
  }

  if (action === "getFiche") {
    const memberId = String(url.searchParams.get("id") || "").trim();
    if (!memberId) throw new ApiError(400, "MembreID manquant");

    const [memberResult, historyResult] = await env.DB.batch([
      env.DB.prepare(`
        SELECT m.id, m.avatar_name, m.first_entry_at, m.discord_name, m.discord_id,
               m.rules_accepted, m.on_frj_server, g.name AS grade, g.level AS niveau
        FROM members m
        JOIN grades g ON g.id = m.grade_id
        WHERE m.id = ?
      `).bind(memberId),
      env.DB.prepare(`
        SELECT mv.effective_at AS date, mv.movement_type AS type,
               COALESCE(g.name, '') AS grade, COALESCE(mv.comment, '') AS commentaire
        FROM movements mv
        LEFT JOIN grades g ON g.id = mv.new_grade_id
        WHERE mv.member_id = ?
        ORDER BY mv.effective_at DESC, mv.rowid DESC
      `).bind(memberId)
    ]);

    const row = memberResult.results[0];
    const membre = row ? {
      id: row.id,
      nom: row.avatar_name,
      datePremiere: row.first_entry_at,
      nomDiscord: row.discord_name || "",
      IDDiscord: row.discord_id || "",
      regleSoc: Boolean(row.rules_accepted),
      serveurFRJ: Boolean(row.on_frj_server),
      grade: row.grade,
      niveau: Number(row.niveau)
    } : null;

    return publicJson({ membre, historique: historyResult.results });
  }

  return json({ error: "unknown action" }, 400);
}

async function handlePost(data, env) {
  if (data.action === "createOrOpenMembre") return createOrOpenMember(data, env);
  if (data.action === "updateMembreInfos") return updateMemberInfo(data, env);
  if (data.action === "applyMembreAction") return applyMemberAction(data, env);
  if (data.action === "syncDiscordFromWeb") return syncDiscordFromWeb(data, env);
  if (data.action === "getSyncStatus") return json(await getSyncStatus(env));
  if (data.action === "runSyncAudit") return json(await runSyncAudit(env));
  if (data.action === "retryPendingSync") {
    return json({ success: true, queued: await flushPendingMutations(env) });
  }
  return json({ success: false, error: "Action inconnue" }, 400);
}

async function createOrOpenMember(data, env) {
  const avatarName = String(data.nomAvatar || "").trim();
  if (!avatarName) throw new ApiError(400, "Nom d'Avatar obligatoire");
  const effectiveAt = parseEffectiveDate(data.dateEffective);
  const normalizedName = normalizeAvatarName(avatarName);

  const existing = await env.DB.prepare(
    "SELECT id FROM members WHERE normalized_avatar_name = ? ORDER BY rowid LIMIT 1"
  ).bind(normalizedName).first();
  if (existing) return json({ success: true, existing: true, membreId: existing.id });

  const traveler = await env.DB.prepare("SELECT id FROM grades WHERE name = 'Voyageur'").first();
  if (!traveler) throw new ApiError(500, "Grade Voyageur introuvable");

  const memberId = crypto.randomUUID();
  const movementId = crypto.randomUUID();
  const now = localIsoNow();
  await env.DB.batch([
    env.DB.prepare(`
      INSERT INTO members (id, avatar_name, normalized_avatar_name, grade_id, first_entry_at, created_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `).bind(memberId, avatarName, normalizedName, traveler.id, effectiveAt, now),
    env.DB.prepare(`
      INSERT INTO movements (id, member_id, recorded_at, effective_at, movement_type, new_grade_id, comment)
      VALUES (?, ?, ?, ?, 'ENTREE', ?, 'Création fiche et nouvelle entrée comme Voyageur')
    `).bind(movementId, memberId, now, effectiveAt, traveler.id)
  ]);

  const sync = await safelyRecordD1Mutation(env, {
    entityType: "MEMBER_AND_MOVEMENT",
    entityId: memberId,
    operation: "CREATE",
    changedAt: new Date().toISOString(),
    payload: await getMemberSyncPayload(env, memberId, movementId)
  });
  return json({ success: true, existing: false, membreId: memberId, sync });
}

async function updateMemberInfo(data, env) {
  const memberId = String(data.membreId || "").trim();
  if (!memberId) throw new ApiError(400, "MembreID manquant");

  const result = await env.DB.prepare(`
    UPDATE members
    SET discord_name = ?, discord_id = ?, rules_accepted = ?, on_frj_server = ?, updated_at = ?
    WHERE id = ?
  `).bind(
    String(data.nomDiscord || "").trim(),
    String(data.IDDiscord || "").trim(),
    toBooleanInteger(data.regleSoc),
    toBooleanInteger(data.serveurFRJ),
    localIsoNow(),
    memberId
  ).run();

  if (!result.meta.changes) throw new ApiError(404, "Membre introuvable");
  const sync = await safelyRecordD1Mutation(env, {
    entityType: "MEMBER",
    entityId: memberId,
    operation: "UPDATE_INFO",
    changedAt: new Date().toISOString(),
    payload: await getMemberSyncPayload(env, memberId)
  });
  return json({ success: true, sync });
}

async function applyMemberAction(data, env) {
  const memberId = String(data.membreId || "").trim();
  const actionType = String(data.membreAction || "").trim();
  if (!memberId) throw new ApiError(400, "MembreID manquant");
  if (!actionType) throw new ApiError(400, "Action membre manquante");
  const effectiveAt = parseEffectiveDate(data.dateEffective);

  const [member, gradeResult] = await Promise.all([
    env.DB.prepare(`
      SELECT m.id, m.first_entry_at, m.discord_id, m.discord_name, m.avatar_name,
             g.id AS grade_id, g.name AS grade_name, g.level AS grade_level
      FROM members m JOIN grades g ON g.id = m.grade_id WHERE m.id = ?
    `).bind(memberId).first(),
    env.DB.prepare("SELECT id, name, level FROM grades ORDER BY level").all()
  ]);
  if (!member) throw new ApiError(404, "Membre introuvable");

  const currentGrade = { id: member.grade_id, name: member.grade_name, level: Number(member.grade_level) };
  const transition = getMemberTransition(actionType, currentGrade, gradeResult.results);
  const firstEntry = actionType === "ENTREE" && !member.first_entry_at ? effectiveAt : member.first_entry_at;
  const rulesAccepted = EXIT_TYPES.has(transition.movementType) ? 0 : null;
  const now = localIsoNow();

  const movementId = crypto.randomUUID();
  await env.DB.batch([
    env.DB.prepare(`
      UPDATE members
      SET grade_id = ?, first_entry_at = ?,
          rules_accepted = CASE WHEN ? IS NULL THEN rules_accepted ELSE ? END,
          updated_at = ?
      WHERE id = ?
    `).bind(transition.newGrade.id, firstEntry, rulesAccepted, rulesAccepted, now, memberId),
    env.DB.prepare(`
      INSERT INTO movements (
        id, member_id, recorded_at, effective_at, movement_type, old_grade_id, new_grade_id, comment
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(
      movementId, memberId, now, effectiveAt, transition.movementType,
      currentGrade.id, transition.newGrade.id, transition.comment
    )
  ]);

  const syncDiscord = await syncDiscordMember({
    discordId: member.discord_id,
    avatarName: member.avatar_name,
    level: Number(transition.newGrade.level),
    removeExitRole: EXIT_TYPES.has(transition.movementType)
  }, env);

  const sync = await safelyRecordD1Mutation(env, {
    entityType: "MEMBER_AND_MOVEMENT",
    entityId: memberId,
    operation: transition.movementType,
    changedAt: new Date().toISOString(),
    payload: await getMemberSyncPayload(env, memberId, movementId)
  });

  return json({
    success: true,
    ancienGrade: currentGrade.name,
    nouveauGrade: transition.newGrade.name,
    typeMouvement: transition.movementType,
    syncDiscord,
    sync
  });
}

async function syncDiscordFromWeb(data, env) {
  const memberId = String(data.membreId || "").trim();
  if (!memberId) throw new ApiError(400, "MembreID manquant");
  const member = await env.DB.prepare(`
    SELECT m.avatar_name, m.discord_id, g.level
    FROM members m JOIN grades g ON g.id = m.grade_id WHERE m.id = ?
  `).bind(memberId).first();
  if (!member) throw new ApiError(404, "Membre introuvable");
  if (!member.discord_id) throw new ApiError(400, "ID Discord manquant pour ce membre");

  const result = await syncDiscordMember({
    discordId: member.discord_id,
    avatarName: member.avatar_name,
    level: Number(member.level),
    removeExitRole: Number(member.level) === 0
  }, env);
  if (!result.success) return json(result, 502);
  return json({ success: true, message: `✅ Synchronisation envoyée pour ${member.avatar_name}` });
}

async function syncDiscordMember(member, env) {
  if (!member.discordId) return { success: false, error: "ID Discord manquant pour ce membre" };
  if (!/^\d{17,20}$/.test(String(member.discordId))) return { success: false, error: "Identifiant Discord invalide" };

  if (!env.DISCORD_PROXY || !env.DISCORD_PROXY_SECRET) {
    return { success: false, error: "Configuration du proxy Discord manquante" };
  }

  try {
    const response = await env.DISCORD_PROXY.fetch("https://discord-proxy/sync", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        discordId: String(member.discordId),
        nomAvatar: String(member.avatarName || ""),
        niveau: Number(member.level),
        secret: env.DISCORD_PROXY_SECRET
      })
    });
    const responseText = await readBoundedText(response.body, 2_000);
    let result;
    try {
      result = JSON.parse(responseText || "{}");
    } catch (_error) {
      return {
        success: false,
        error: `Réponse invalide du proxy Discord (HTTP ${response.status})`
      };
    }
    if (!response.ok || result.success !== true) {
      return { success: false, error: result.error || `Proxy Discord HTTP ${response.status}` };
    }

    if (member.removeExitRole) {
      await removeDiscordRole({
        discordId: member.discordId,
        guildId: env.DISCORD_GUILD_ID,
        roleId: env.RULES_ACCEPTED_ROLE_ID,
        botToken: env.DISCORD_BOT_TOKEN
      });
    }

    return {
      success: true,
      removedRulesAcceptedRole: Boolean(member.removeExitRole)
    };
  } catch (error) {
    console.error(JSON.stringify({ message: "Discord sync failed", error: error.message, memberId: member.discordId }));
    return { success: false, error: error.message };
  }
}

function toLegacyMovement(row) {
  return {
    MouvementID: row.id,
    MembreID: row.member_id,
    DateHeureSaisie: row.recorded_at,
    DateEffective: row.effective_at,
    TypeMouvement: row.movement_type,
    AncienGradeID: row.old_grade_id || "",
    NouveauGradeID: row.new_grade_id || "",
    Commentaire: row.comment || "",
    GestionnaireID: row.manager_id || ""
  };
}

function formatFrenchDate(value) {
  if (!value) return "";
  const match = String(value).match(/^(\d{4})-(\d{2})-(\d{2})/);
  return match ? `${match[3]}/${match[2]}/${match[1]}` : "";
}

function localIsoNow() {
  const parts = Object.fromEntries(new Intl.DateTimeFormat("fr-CA", {
    timeZone: "Europe/Paris", year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23"
  }).formatToParts(new Date()).map((part) => [part.type, part.value]));
  return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}:${parts.second}`;
}

function toBooleanInteger(value) {
  return value === true || String(value).trim().toLowerCase() === "true" ? 1 : 0;
}

async function readJson(request) {
  const length = Number(request.headers.get("Content-Length") || 0);
  if (length > MAX_BODY_BYTES) throw new ApiError(413, "Requête trop volumineuse");

  const text = await readBoundedText(request.body, MAX_BODY_BYTES);
  let data;
  try {
    data = JSON.parse(text || "{}");
  } catch {
    throw new ApiError(400, "JSON invalide");
  }
  return data;
}

async function readBoundedText(body, limit) {
  if (!body) return "";

  const reader = body.getReader();
  const decoder = new TextDecoder();
  const chunks = [];
  let bytes = 0;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    bytes += value.byteLength;
    if (bytes > limit) {
      await reader.cancel("Payload too large");
      throw new ApiError(413, "Requête trop volumineuse");
    }
    chunks.push(decoder.decode(value, { stream: true }));
  }

  chunks.push(decoder.decode());
  return chunks.join("");
}

async function isAuthorized(request, expectedToken) {
  if (!expectedToken) return false;
  const header = request.headers.get("Authorization") || "";
  const supplied = header.startsWith("Bearer ") ? header.slice(7) : "";
  if (!supplied) return false;
  const encoder = new TextEncoder();
  const [left, right] = await Promise.all([
    crypto.subtle.digest("SHA-256", encoder.encode(supplied)),
    crypto.subtle.digest("SHA-256", encoder.encode(expectedToken))
  ]);
  return crypto.subtle.timingSafeEqual(left, right);
}

async function isSyncAuthorized(suppliedToken, expectedToken) {
  if (!expectedToken || !suppliedToken) return false;
  const encoder = new TextEncoder();
  const [left, right] = await Promise.all([
    crypto.subtle.digest("SHA-256", encoder.encode(String(suppliedToken))),
    crypto.subtle.digest("SHA-256", encoder.encode(String(expectedToken)))
  ]);
  return crypto.subtle.timingSafeEqual(left, right);
}

async function safelyRecordD1Mutation(env, mutation) {
  try {
    const mutationId = await recordD1Mutation(env, mutation);
    return { accepted: true, mutationId, mode: env.SYNC_MODE || "observe" };
  } catch (error) {
    console.error(JSON.stringify({
      message: "Unable to record D1 sync mutation",
      entityId: mutation.entityId,
      error: error instanceof Error ? error.message : String(error)
    }));
    return { accepted: false, error: error instanceof Error ? error.message : String(error) };
  }
}

async function getMemberSyncPayload(env, memberId, movementId = null) {
  const member = await env.DB.prepare(`
    SELECT id, avatar_name, grade_id, first_entry_at, created_at, updated_at,
           discord_name, discord_id, on_frj_server, rules_accepted
    FROM members WHERE id = ?
  `).bind(memberId).first();
  if (!member) throw new ApiError(404, "Membre introuvable");

  let movement = null;
  if (movementId) {
    movement = await env.DB.prepare(`
      SELECT id, member_id, recorded_at, effective_at, movement_type,
             old_grade_id, new_grade_id, comment, manager_id
      FROM movements WHERE id = ?
    `).bind(movementId).first();
  }

  return {
    member: {
      id: member.id,
      avatarName: member.avatar_name,
      gradeId: member.grade_id,
      firstEntryAt: member.first_entry_at,
      createdAt: member.created_at,
      updatedAt: member.updated_at,
      discordName: member.discord_name,
      discordId: member.discord_id,
      onFrjServer: Boolean(member.on_frj_server),
      rulesAccepted: Boolean(member.rules_accepted)
    },
    movement: movement ? {
      id: movement.id,
      memberId: movement.member_id,
      recordedAt: movement.recorded_at,
      effectiveAt: movement.effective_at,
      movementType: movement.movement_type,
      oldGradeId: movement.old_grade_id,
      newGradeId: movement.new_grade_id,
      comment: movement.comment,
      managerId: movement.manager_id
    } : null
  };
}

function publicJson(data) {
  const response = json(data);
  response.headers.set("Cache-Control", "public, max-age=30, s-maxage=60");
  return response;
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json; charset=UTF-8" }
  });
}

function allowedOrigins(env) {
  return new Set([env.PUBLIC_SITE_ORIGIN, "http://localhost:8787", "http://127.0.0.1:8787"].filter(Boolean));
}

function corsPreflight(origin, env) {
  if (!allowedOrigins(env).has(origin)) return new Response(null, { status: 403 });
  return new Response(null, {
    status: 204,
    headers: {
      "Access-Control-Allow-Origin": origin,
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Headers": "Authorization, Content-Type",
      "Access-Control-Max-Age": "86400",
      "Vary": "Origin"
    }
  });
}

function withCors(response, origin, env) {
  if (allowedOrigins(env).has(origin)) {
    response.headers.set("Access-Control-Allow-Origin", origin);
    response.headers.set("Vary", "Origin");
  }
  return response;
}

class ApiError extends Error {
  constructor(status, message) {
    super(message);
    this.name = "ApiError";
    this.status = status;
  }
}
