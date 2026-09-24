import { enqueueDiscordRoleRefresh } from "./discord-roles.js";
import { flushPendingMutations, runSyncAudit } from "./sync.js";

export const DAILY_MAINTENANCE_CRON = "17 3 * * *";
const MAINTENANCE_JOB = "daily-maintenance";

export async function runScheduledMaintenance(controller, env, overrides = {}) {
  // Une erreur ne doit jamais rejouer les tâches déjà terminées : D-002 peut
  // produire plusieurs centaines d'opérations Queue à chaque exécution.
  controller.noRetry();

  if (controller.cron !== DAILY_MAINTENANCE_CRON) {
    console.warn(JSON.stringify({
      message: "Unexpected cron ignored",
      expectedCron: DAILY_MAINTENANCE_CRON,
      receivedCron: controller.cron || null
    }));
    return { skipped: true, reason: "UNEXPECTED_CRON" };
  }

  const now = overrides.now || new Date().toISOString();
  const runDate = now.slice(0, 10);
  if (!(await claimDailyRun(env, MAINTENANCE_JOB, runDate, now))) {
    console.warn(JSON.stringify({ message: "Duplicate daily maintenance ignored", runDate }));
    return { skipped: true, reason: "ALREADY_RUN", runDate };
  }

  const tasks = overrides.tasks || {
    pendingMutations: () => flushPendingMutations(env),
    syncAudit: () => runSyncAudit(env),
    discordRoles: () => enqueueDiscordRoleRefresh(env, { now })
  };
  const entries = Object.entries(tasks);
  const settled = await Promise.allSettled(entries.map(([, task]) => task()));
  const details = Object.fromEntries(settled.map((result, index) => {
    const name = entries[index][0];
    return result.status === "fulfilled"
      ? [name, { status: "fulfilled", value: result.value }]
      : [name, { status: "rejected", error: String(result.reason?.message || result.reason).slice(0, 1000) }];
  }));
  const failed = settled.some((result) => result.status === "rejected");

  await finishDailyRun(env, MAINTENANCE_JOB, runDate, failed ? "PARTIAL_FAILURE" : "COMPLETED", details);
  if (failed) console.error(JSON.stringify({ message: "Daily maintenance partially failed", runDate, details }));
  return { skipped: false, runDate, details };
}

export async function claimDailyRun(env, jobName, runDate, startedAt) {
  const result = await env.DB.prepare(`
    INSERT INTO scheduled_job_runs (job_name, run_date, status, started_at)
    VALUES (?, ?, 'RUNNING', ?)
    ON CONFLICT(job_name, run_date) DO NOTHING
  `).bind(jobName, runDate, startedAt).run();
  return Number(result.meta?.changes || 0) === 1;
}

async function finishDailyRun(env, jobName, runDate, status, details) {
  await env.DB.prepare(`
    UPDATE scheduled_job_runs
    SET status = ?, finished_at = ?, details_json = ?
    WHERE job_name = ? AND run_date = ?
  `).bind(status, new Date().toISOString(), JSON.stringify(details), jobName, runDate).run();
}
