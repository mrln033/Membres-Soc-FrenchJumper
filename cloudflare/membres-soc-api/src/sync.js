const SYNC_BODY_LIMIT = 64_000;

export async function recordD1Mutation(env, mutation) {
  const now = mutation.changedAt || new Date().toISOString();
  const row = normalizeMutation({
    ...mutation,
    id: mutation.id || crypto.randomUUID(),
    source: "D1",
    target: "GAS",
    changedAt: now
  });

  await env.DB.batch([
    env.DB.prepare(`
      INSERT OR IGNORE INTO sync_mutations (
        id, source, entity_type, entity_id, operation, changed_at,
        payload_json, target, status, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'PENDING', ?)
    `).bind(
      row.id, row.source, row.entityType, row.entityId, row.operation,
      row.changedAt, JSON.stringify(row.payload), row.target, now
    ),
    env.DB.prepare(`
      INSERT INTO sync_entity_versions (entity_type, entity_id, changed_at, source, mutation_id)
      VALUES (?, ?, ?, 'D1', ?)
      ON CONFLICT(entity_type, entity_id) DO UPDATE SET
        changed_at = excluded.changed_at, source = excluded.source, mutation_id = excluded.mutation_id
    `).bind(row.entityType, row.entityId, row.changedAt, row.id)
  ]);

  await queueMutation(env, row.id);
  return row.id;
}

export async function receiveGasMutation(env, data) {
  const mutation = normalizeMutation(data.mutation || data);
  if (!["GAS", "SHEET_MANUAL"].includes(mutation.source)) {
    throw new SyncError(400, "Source de synchronisation invalide");
  }

  const existing = await env.DB.prepare(
    "SELECT status FROM sync_mutations WHERE id = ?"
  ).bind(mutation.id).first();
  if (existing && ["APPLIED", "CONFLICT"].includes(existing.status)) {
    return { success: true, duplicate: true, status: existing.status };
  }

  const now = new Date().toISOString();
  await env.DB.prepare(`
    INSERT OR IGNORE INTO sync_mutations (
      id, source, entity_type, entity_id, operation, changed_at,
      payload_json, target, status, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, 'D1', 'PENDING', ?)
  `).bind(
    mutation.id, mutation.source, mutation.entityType, mutation.entityId,
    mutation.operation, mutation.changedAt, JSON.stringify(mutation.payload), now
  ).run();

  const result = await applyMutationToD1(env, mutation);
  return { success: true, duplicate: false, ...result };
}

export async function applyMutationToD1(env, mutation) {
  const current = await env.DB.prepare(`
    SELECT changed_at, mutation_id FROM sync_entity_versions
    WHERE entity_type = ? AND entity_id = ?
  `).bind(mutation.entityType, mutation.entityId).first();

  if (current && compareVersion(mutation.changedAt, mutation.id, current.changed_at, current.mutation_id) < 0) {
    await markMutation(env, mutation.id, "CONFLICT", "Mutation plus ancienne que la version D1");
    return { applied: false, conflict: true };
  }

  const statements = buildD1ReplicationStatements(env.DB, mutation.payload);
  statements.push(env.DB.prepare(`
    INSERT INTO sync_entity_versions (entity_type, entity_id, changed_at, source, mutation_id)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(entity_type, entity_id) DO UPDATE SET
      changed_at = excluded.changed_at,
      source = excluded.source,
      mutation_id = excluded.mutation_id
  `).bind(mutation.entityType, mutation.entityId, mutation.changedAt, mutation.source, mutation.id));
  statements.push(env.DB.prepare(`
    UPDATE sync_mutations
    SET status = 'APPLIED', applied_at = ?, attempts = attempts + 1, last_error = NULL
    WHERE id = ?
  `).bind(new Date().toISOString(), mutation.id));

  await env.DB.batch(statements);
  return { applied: true, conflict: false };
}

export async function handleSyncQueue(batch, env) {
  for (const message of batch.messages) {
    try {
      const mutationId = String(message.body?.mutationId || "");
      const row = await env.DB.prepare(`
        SELECT id, source, entity_type, entity_id, operation, changed_at, payload_json
        FROM sync_mutations WHERE id = ? AND target = 'GAS'
      `).bind(mutationId).first();

      if (!row) {
        message.ack();
        continue;
      }

      const mutation = mutationFromRow(row);
      const response = await fetch(env.GAS_SYNC_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "replicateFromD1",
          syncSecret: env.SYNC_SHARED_SECRET,
          mutation
        })
      });
      const text = await readBoundedResponse(response, SYNC_BODY_LIMIT);
      let result = {};
      try { result = JSON.parse(text || "{}"); } catch { /* handled below */ }

      if (!response.ok || result.success !== true) {
        throw new Error(result.error || `GAS HTTP ${response.status}`);
      }

      await markMutation(env, mutationId, "APPLIED", null);
      message.ack();
    } catch (error) {
      const mutationId = String(message.body?.mutationId || "");
      if (mutationId) await recordAttemptFailure(env, mutationId, error);
      message.retry({ delaySeconds: 30 });
    }
  }
}

export async function flushPendingMutations(env, limit = 50) {
  if (!env.SYNC_QUEUE) return 0;
  const result = await env.DB.prepare(`
    SELECT id FROM sync_mutations
    WHERE target = 'GAS' AND status IN ('PENDING', 'FAILED')
    ORDER BY created_at LIMIT ?
  `).bind(limit).all();

  for (const row of result.results) await queueMutation(env, row.id);
  return result.results.length;
}

export async function getSyncStatus(env) {
  const [counts, recent, audit] = await env.DB.batch([
    env.DB.prepare(`
      SELECT status, target, COUNT(*) AS count
      FROM sync_mutations GROUP BY status, target ORDER BY target, status
    `),
    env.DB.prepare(`
      SELECT id, source, target, entity_type, entity_id, operation, status,
             attempts, last_error, created_at, applied_at
      FROM sync_mutations ORDER BY created_at DESC LIMIT 50
    `),
    env.DB.prepare(`SELECT * FROM sync_audits ORDER BY started_at DESC LIMIT 1`)
  ]);
  return { counts: counts.results, recent: recent.results, lastAudit: audit.results[0] || null };
}

export async function runSyncAudit(env) {
  const auditId = crypto.randomUUID();
  const startedAt = new Date().toISOString();
  await env.DB.prepare(`
    INSERT INTO sync_audits (id, started_at, status) VALUES (?, ?, 'RUNNING')
  `).bind(auditId, startedAt).run();

  try {
    if (!env.GAS_SYNC_URL || !env.SYNC_SHARED_SECRET) {
      throw new Error("Configuration d'audit GAS manquante");
    }
    const [d1Counts, gasResponse] = await Promise.all([
      env.DB.prepare(`
        SELECT
          (SELECT COUNT(*) FROM members) AS members,
          (SELECT COUNT(*) FROM movements) AS movements
      `).first(),
      fetch(env.GAS_SYNC_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "getGasSyncSnapshot",
          syncSecret: env.SYNC_SHARED_SECRET
        })
      })
    ]);
    const text = await readBoundedResponse(gasResponse, SYNC_BODY_LIMIT);
    let gas = {};
    try { gas = JSON.parse(text || "{}"); } catch { /* handled below */ }
    if (!gasResponse.ok || gas.success !== true) {
      throw new Error(gas.error || `GAS HTTP ${gasResponse.status}`);
    }

    const countDifferences =
      Math.abs(Number(d1Counts.members) - Number(gas.members)) +
      Math.abs(Number(d1Counts.movements) - Number(gas.movements));
    const finishedAt = new Date().toISOString();
    await env.DB.prepare(`
      UPDATE sync_audits SET finished_at = ?, status = ?, members_d1 = ?, members_gas = ?,
        movements_d1 = ?, movements_gas = ?, differences = ?, details_json = ? WHERE id = ?
    `).bind(
      finishedAt, countDifferences === 0 ? "COUNTS_MATCH" : "DIFFERENCE",
      d1Counts.members, gas.members, d1Counts.movements, gas.movements,
      countDifferences, JSON.stringify({ gasGeneratedAt: gas.generatedAt }), auditId
    ).run();
    return { success: true, auditId, countDifferences };
  } catch (error) {
    await env.DB.prepare(`
      UPDATE sync_audits SET finished_at = ?, status = 'FAILED', details_json = ? WHERE id = ?
    `).bind(
      new Date().toISOString(),
      JSON.stringify({ error: String(error?.message || error).slice(0, 1000) }),
      auditId
    ).run();
    return { success: false, auditId, error: String(error?.message || error) };
  }
}

export function normalizeMutation(input) {
  const mutation = {
    id: String(input.id || "").trim(),
    source: String(input.source || "").trim(),
    target: String(input.target || "D1").trim(),
    entityType: String(input.entityType || "").trim(),
    entityId: String(input.entityId || "").trim(),
    operation: String(input.operation || "UPSERT").trim(),
    changedAt: String(input.changedAt || "").trim(),
    payload: input.payload
  };
  if (!mutation.id || !mutation.entityId || !mutation.changedAt || !mutation.payload) {
    throw new SyncError(400, "Mutation de synchronisation incomplète");
  }
  if (!["MEMBER", "MEMBER_AND_MOVEMENT"].includes(mutation.entityType)) {
    throw new SyncError(400, "Type d'entité de synchronisation invalide");
  }
  if (Number.isNaN(Date.parse(mutation.changedAt))) {
    throw new SyncError(400, "Date de mutation invalide");
  }
  return mutation;
}

function buildD1ReplicationStatements(db, payload) {
  const member = payload.member;
  if (!member?.id || !member?.gradeId) throw new SyncError(400, "Snapshot membre incomplet");

  const statements = [db.prepare(`
    INSERT INTO members (
      id, avatar_name, normalized_avatar_name, grade_id, first_entry_at,
      created_at, updated_at, discord_name, discord_id, on_frj_server, rules_accepted
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      avatar_name = excluded.avatar_name,
      normalized_avatar_name = excluded.normalized_avatar_name,
      grade_id = excluded.grade_id,
      first_entry_at = excluded.first_entry_at,
      created_at = COALESCE(members.created_at, excluded.created_at),
      updated_at = excluded.updated_at,
      discord_name = excluded.discord_name,
      discord_id = excluded.discord_id,
      on_frj_server = excluded.on_frj_server,
      rules_accepted = excluded.rules_accepted
  `).bind(
    member.id, member.avatarName, normalizeName(member.avatarName), member.gradeId,
    member.firstEntryAt || null, member.createdAt || null, member.updatedAt || null,
    member.discordName || null, member.discordId || null,
    member.onFrjServer ? 1 : 0, member.rulesAccepted ? 1 : 0
  )];

  if (payload.movement?.id) {
    const movement = payload.movement;
    statements.push(db.prepare(`
      INSERT INTO movements (
        id, member_id, recorded_at, effective_at, movement_type,
        old_grade_id, new_grade_id, comment, manager_id
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        member_id = excluded.member_id,
        recorded_at = excluded.recorded_at,
        effective_at = excluded.effective_at,
        movement_type = excluded.movement_type,
        old_grade_id = excluded.old_grade_id,
        new_grade_id = excluded.new_grade_id,
        comment = excluded.comment,
        manager_id = excluded.manager_id
    `).bind(
      movement.id, movement.memberId, movement.recordedAt || null, movement.effectiveAt,
      movement.movementType, movement.oldGradeId || null, movement.newGradeId || null,
      movement.comment || null, movement.managerId || null
    ));
  }
  return statements;
}

async function queueMutation(env, mutationId) {
  if (!env.SYNC_QUEUE || String(env.SYNC_MODE || "observe") !== "active") return;
  await env.SYNC_QUEUE.send({ mutationId });
  await env.DB.prepare(`
    UPDATE sync_mutations SET status = 'QUEUED', queued_at = ? WHERE id = ?
  `).bind(new Date().toISOString(), mutationId).run();
}

async function markMutation(env, id, status, error) {
  await env.DB.prepare(`
    UPDATE sync_mutations
    SET status = ?, applied_at = CASE WHEN ? = 'APPLIED' THEN ? ELSE applied_at END,
        attempts = attempts + 1, last_error = ?
    WHERE id = ?
  `).bind(status, status, new Date().toISOString(), error, id).run();
}

async function recordAttemptFailure(env, id, error) {
  await env.DB.prepare(`
    UPDATE sync_mutations SET status = 'FAILED', attempts = attempts + 1, last_error = ?
    WHERE id = ?
  `).bind(String(error?.message || error).slice(0, 1000), id).run();
}

function mutationFromRow(row) {
  return {
    id: row.id,
    source: row.source,
    target: "GAS",
    entityType: row.entity_type,
    entityId: row.entity_id,
    operation: row.operation,
    changedAt: row.changed_at,
    payload: JSON.parse(row.payload_json)
  };
}

function compareVersion(leftDate, leftId, rightDate, rightId) {
  const dateComparison = String(leftDate).localeCompare(String(rightDate));
  return dateComparison || String(leftId).localeCompare(String(rightId));
}

function normalizeName(value) {
  return String(value || "").trim().replace(/\s+/g, " ").toLowerCase();
}

async function readBoundedResponse(response, limit) {
  if (!response.body) return "";
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  const chunks = [];
  let bytes = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    bytes += value.byteLength;
    if (bytes > limit) throw new Error("Réponse GAS trop volumineuse");
    chunks.push(decoder.decode(value, { stream: true }));
  }
  chunks.push(decoder.decode());
  return chunks.join("");
}

export class SyncError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}
