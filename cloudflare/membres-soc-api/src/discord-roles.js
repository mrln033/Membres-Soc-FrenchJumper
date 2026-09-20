import { DiscordApiError, getDiscordGuildMember } from "./discord.js";

const QUEUE_TYPE = "DISCORD_ROLE_REFRESH";
const DISCORD_ID_PATTERN = /^\d{17,20}$/;

export async function getCachedDiscordRoles(env, memberId, includeStaff = false) {
  const [rolesResult, syncState] = await env.DB.batch([
    env.DB.prepare(`
      SELECT c.discord_role_id AS id, c.label, c.category
      FROM member_discord_roles mr
      JOIN discord_role_catalog c ON c.discord_role_id = mr.discord_role_id
      WHERE mr.member_id = ? AND c.active = 1
        AND (c.public_visible = 1 OR ? = 1)
      ORDER BY c.category, c.display_order, c.label COLLATE NOCASE
    `).bind(memberId, includeStaff ? 1 : 0),
    env.DB.prepare(`
      SELECT status, last_success_at, last_error
      FROM member_discord_role_sync WHERE member_id = ?
    `).bind(memberId)
  ]);

  const grouped = { functions: [], activities: [], responsibilities: [] };
  for (const role of rolesResult.results) {
    const item = { id: role.id, label: role.label };
    if (role.category === "GAME_FUNCTION") grouped.functions.push(item);
    if (role.category === "GAME_ACTIVITY") grouped.activities.push(item);
    if (role.category === "DISCORD_STAFF") grouped.responsibilities.push(item);
  }
  const state = syncState.results[0] || null;
  return {
    ...grouped,
    syncedAt: state?.last_success_at || null,
    status: state?.status || "PENDING",
    error: includeStaff && state?.last_error ? state.last_error : null
  };
}

export async function enqueueDiscordRoleRefresh(env) {
  if (String(env.DISCORD_ROLE_SYNC_MODE || "off") !== "active" || !env.DISCORD_ROLE_QUEUE) return 0;
  const result = await env.DB.prepare(`
    SELECT id FROM members
    WHERE discord_id GLOB '[0-9]*' AND length(discord_id) BETWEEN 17 AND 20
    ORDER BY id
  `).all();
  const messages = result.results.map((row) => ({ body: { type: QUEUE_TYPE, memberId: row.id } }));
  for (let index = 0; index < messages.length; index += 100) {
    await env.DISCORD_ROLE_QUEUE.sendBatch(messages.slice(index, index + 100));
  }
  return messages.length;
}

export async function handleDiscordRoleQueue(batch, env) {
  const completed = [];
  // Le catalogue est commun à tout le lot. Le relire pour chaque membre
  // multipliait inutilement les rows read D1 (jusqu'à 10 fois par lot).
  const allowedRoleIds = await getActiveDiscordRoleIds(env);
  for (const message of batch.messages) {
    try {
      const refresh = await refreshDiscordRoleState(env, message.body?.memberId, fetch, allowedRoleIds);
      completed.push({ message, memberId: String(message.body?.memberId || ""), ...refresh });
    } catch (error) {
      console.error(JSON.stringify({
        message: "Discord role refresh failed",
        memberId: message.body?.memberId,
        error: error instanceof Error ? error.message : String(error)
      }));
      const delaySeconds = error instanceof DiscordApiError && error.retryAfterSeconds
        ? Math.min(3600, Math.max(1, Math.ceil(error.retryAfterSeconds)))
        : 30;
      message.retry({ delaySeconds });
    }
  }

  if (!completed.length) return;
  try {
    const pending = completed.filter((item) => item.needsGasReplication);
    if (pending.length) {
      await replicateRolesBatchToGas(env, pending.map((item) => ({
        memberId: item.memberId,
        roles: item.snapshot
      })));
    }
    for (const item of completed) item.message.ack();
  } catch (error) {
    console.error(JSON.stringify({
      message: "Discord role batch replication failed",
      members: completed.map((item) => item.memberId),
      error: error instanceof Error ? error.message : String(error)
    }));
    for (const item of completed) item.message.retry({ delaySeconds: 30 });
  }
}

export async function refreshDiscordRolesForMember(env, memberId, fetcher = fetch) {
  const allowedRoleIds = await getActiveDiscordRoleIds(env);
  const refresh = await refreshDiscordRoleState(env, memberId, fetcher, allowedRoleIds);
  if (refresh.needsGasReplication) {
    await replicateRolesBatchToGas(env, [{ memberId: String(memberId || "").trim(), roles: refresh.snapshot }]);
  }
  return refresh.snapshot;
}

async function refreshDiscordRoleState(env, memberId, fetcher = fetch, allowedRoleIds = null) {
  const id = String(memberId || "").trim();
  if (!id) throw new Error("MembreID manquant");
  const member = await env.DB.prepare(`
    SELECT m.id, m.discord_id, s.role_hash, s.gas_synced_at
    FROM members m
    LEFT JOIN member_discord_role_sync s ON s.member_id = m.id
    WHERE m.id = ?
  `
  ).bind(id).first();
  if (!member) throw new Error("Membre introuvable");

  const now = new Date().toISOString();
  const discordId = String(member.discord_id || "").trim();
  if (!DISCORD_ID_PATTERN.test(discordId)) {
    await upsertSyncState(env, id, discordId || null, "INVALID_ID", now, null, "ID Discord absent ou invalide");
    return { snapshot: await getCachedDiscordRoles(env, id, true), needsGasReplication: false };
  }

  let discordMember;
  try {
    discordMember = await getDiscordGuildMember({
      discordId,
      guildId: env.DISCORD_GUILD_ID,
      botToken: env.DISCORD_BOT_TOKEN
    }, fetcher);
  } catch (error) {
    await upsertSyncState(env, id, discordId, "ERROR", now, null, String(error?.message || error).slice(0, 1000));
    throw error;
  }

  const allowed = allowedRoleIds || await getActiveDiscordRoleIds(env);
  const roleIds = discordMember.found
    ? [...new Set(discordMember.roles.map(String).filter((roleId) => allowed.has(roleId)))].sort()
    : [];
  const roleHash = roleIds.join(",");
  const changed = String(member.role_hash || "") !== roleHash;

  const statements = [];
  if (changed) {
    statements.push(env.DB.prepare("DELETE FROM member_discord_roles WHERE member_id = ?").bind(id));
    for (const roleId of roleIds) {
      statements.push(env.DB.prepare(`
        INSERT INTO member_discord_roles (member_id, discord_role_id, first_seen_at, last_seen_at)
        VALUES (?, ?, ?, ?)
      `).bind(id, roleId, now, now));
    }
  }
  statements.push(env.DB.prepare(`
    INSERT INTO member_discord_role_sync (
      member_id, discord_id, status, role_hash, last_attempt_at, last_success_at, gas_synced_at, last_error
    ) VALUES (?, ?, ?, ?, ?, ?, ?, NULL)
    ON CONFLICT(member_id) DO UPDATE SET
      discord_id = excluded.discord_id,
      status = excluded.status,
      role_hash = excluded.role_hash,
      last_attempt_at = excluded.last_attempt_at,
      last_success_at = excluded.last_success_at,
      gas_synced_at = CASE WHEN member_discord_role_sync.role_hash = excluded.role_hash
        THEN member_discord_role_sync.gas_synced_at ELSE NULL END,
      last_error = NULL
  `).bind(id, discordId, discordMember.found ? "OK" : "ABSENT", roleHash, now, now, changed ? null : member.gas_synced_at || null));
  await env.DB.batch(statements);

  const snapshot = await getCachedDiscordRoles(env, id, true);
  return { snapshot, needsGasReplication: changed || !member.gas_synced_at };
}

async function getActiveDiscordRoleIds(env) {
  const catalogue = await env.DB.prepare(
    "SELECT discord_role_id FROM discord_role_catalog WHERE active = 1"
  ).all();
  return new Set(catalogue.results.map((row) => String(row.discord_role_id)));
}

function upsertSyncState(env, memberId, discordId, status, attemptedAt, succeededAt, error) {
  return env.DB.prepare(`
    INSERT INTO member_discord_role_sync (
      member_id, discord_id, status, last_attempt_at, last_success_at, last_error
    ) VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(member_id) DO UPDATE SET
      discord_id = excluded.discord_id,
      status = excluded.status,
      last_attempt_at = excluded.last_attempt_at,
      last_success_at = COALESCE(excluded.last_success_at, member_discord_role_sync.last_success_at),
      last_error = excluded.last_error
  `).bind(memberId, discordId, status, attemptedAt, succeededAt, error).run();
}

async function replicateRolesBatchToGas(env, snapshots) {
  if (!env.GAS_SYNC_URL || !env.SYNC_SHARED_SECRET) throw new Error("Configuration de réplication GAS manquante");
  const response = await fetch(env.GAS_SYNC_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      action: "replicateDiscordRolesBatchFromD1",
      syncSecret: env.SYNC_SHARED_SECRET,
      snapshots
    })
  });
  const text = await readBoundedText(response.body, 16_000);
  let result = {};
  try { result = JSON.parse(text || "{}"); } catch { /* handled below */ }
  if (!response.ok || result.success !== true) throw new Error(result.error || `GAS HTTP ${response.status}`);
  const now = new Date().toISOString();
  await env.DB.batch(snapshots.map((snapshot) => env.DB.prepare(
    "UPDATE member_discord_role_sync SET gas_synced_at = ? WHERE member_id = ?"
  ).bind(now, snapshot.memberId)));
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
      throw new Error("Réponse GAS trop volumineuse");
    }
    chunks.push(decoder.decode(value, { stream: true }));
  }
  chunks.push(decoder.decode());
  return chunks.join("");
}

export function isDiscordRoleMessage(message) {
  return message?.body?.type === QUEUE_TYPE;
}
