ALTER TABLE model_call_logs
    ADD COLUMN IF NOT EXISTS raw_output JSONB NOT NULL DEFAULT '{}'::jsonb,
    ADD COLUMN IF NOT EXISTS error_kind TEXT NOT NULL DEFAULT '';

CREATE TABLE IF NOT EXISTS interview_plans (
    id TEXT PRIMARY KEY,
    application_id TEXT NOT NULL REFERENCES applications(id) ON DELETE CASCADE,
    status TEXT NOT NULL,
    version TEXT NOT NULL,
    data JSONB NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_interview_plans_application_id
    ON interview_plans(application_id);

CREATE TABLE IF NOT EXISTS interview_attempts (
    id TEXT PRIMARY KEY,
    application_id TEXT NOT NULL REFERENCES applications(id) ON DELETE CASCADE,
    plan_id TEXT REFERENCES interview_plans(id) ON DELETE SET NULL,
    attempt_no INTEGER NOT NULL,
    status TEXT NOT NULL,
    entry_token_hash TEXT NOT NULL DEFAULT '',
    entry_url TEXT NOT NULL DEFAULT '',
    session_ref TEXT NOT NULL DEFAULT '',
    report_ref TEXT NOT NULL DEFAULT '',
    error_message TEXT NOT NULL DEFAULT '',
    data JSONB NOT NULL DEFAULT '{}'::jsonb,
    invited_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    expires_at TIMESTAMPTZ,
    started_at TIMESTAMPTZ,
    completed_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_interview_attempts_application_id
    ON interview_attempts(application_id);
