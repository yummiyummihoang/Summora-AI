ALTER TABLE jobs
  DROP CONSTRAINT IF EXISTS jobs_status_check;

ALTER TABLE jobs
  ADD CONSTRAINT jobs_status_check
  CHECK (status IN ('queued','running','cancelling','cancelled','completed','completed_with_errors','failed','interrupted'));

ALTER TABLE jobs
  ADD COLUMN IF NOT EXISTS workflow_run text;
