CREATE TABLE scheduled_job_runs (
  job_name TEXT NOT NULL,
  run_date TEXT NOT NULL,
  status TEXT NOT NULL,
  started_at TEXT NOT NULL,
  finished_at TEXT,
  details_json TEXT,
  PRIMARY KEY (job_name, run_date)
);

CREATE INDEX idx_scheduled_job_runs_started_at
  ON scheduled_job_runs(started_at DESC);

PRAGMA optimize;
