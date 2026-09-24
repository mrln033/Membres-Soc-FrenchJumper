import test from "node:test";
import assert from "node:assert/strict";
import { DAILY_MAINTENANCE_CRON, runScheduledMaintenance } from "../src/scheduled.js";

function createDb({ claimChanges = 1 } = {}) {
  const calls = [];
  return {
    calls,
    prepare(sql) {
      return {
        bind(...values) {
          return {
            async run() {
              calls.push({ sql, values });
              return { meta: { changes: sql.includes("INSERT INTO scheduled_job_runs") ? claimChanges : 1 } };
            }
          };
        }
      };
    }
  };
}

test("ignore tout cron différent du cron quotidien", async () => {
  let noRetryCalls = 0;
  let taskCalls = 0;
  const result = await runScheduledMaintenance(
    { cron: "*/10 * * * *", noRetry() { noRetryCalls += 1; } },
    { DB: createDb() },
    { tasks: { discordRoles: async () => { taskCalls += 1; } }, now: "2026-09-24T10:00:00.000Z" }
  );

  assert.equal(noRetryCalls, 1);
  assert.equal(taskCalls, 0);
  assert.deepEqual(result, { skipped: true, reason: "UNEXPECTED_CRON" });
});

test("n'exécute la maintenance qu'une fois par jour", async () => {
  let taskCalls = 0;
  const result = await runScheduledMaintenance(
    { cron: DAILY_MAINTENANCE_CRON, noRetry() {} },
    { DB: createDb({ claimChanges: 0 }) },
    { tasks: { discordRoles: async () => { taskCalls += 1; } }, now: "2026-09-24T03:17:00.000Z" }
  );

  assert.equal(taskCalls, 0);
  assert.equal(result.reason, "ALREADY_RUN");
});

test("isole l'échec d'une tâche sans rejouer les autres", async () => {
  const calls = [];
  const db = createDb();
  const result = await runScheduledMaintenance(
    { cron: DAILY_MAINTENANCE_CRON, noRetry() {} },
    { DB: db },
    {
      now: "2026-09-24T03:17:00.000Z",
      tasks: {
        first: async () => { calls.push("first"); return 1; },
        broken: async () => { calls.push("broken"); throw new Error("panne test"); },
        last: async () => { calls.push("last"); return 3; }
      }
    }
  );

  assert.deepEqual(calls, ["first", "broken", "last"]);
  assert.equal(result.details.first.status, "fulfilled");
  assert.equal(result.details.broken.status, "rejected");
  assert.equal(result.details.last.status, "fulfilled");
  assert.equal(db.calls.at(-1).values[0], "PARTIAL_FAILURE");
});
