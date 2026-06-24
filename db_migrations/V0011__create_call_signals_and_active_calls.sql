CREATE TABLE IF NOT EXISTS call_signals (
  id SERIAL PRIMARY KEY,
  call_id TEXT NOT NULL,
  from_user_id INTEGER NOT NULL,
  to_user_id INTEGER NOT NULL,
  type TEXT NOT NULL,
  payload TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_call_signals_call_id ON call_signals(call_id);
CREATE INDEX IF NOT EXISTS idx_call_signals_to_user ON call_signals(to_user_id, call_id);

CREATE TABLE IF NOT EXISTS active_calls (
  call_id TEXT PRIMARY KEY,
  caller_id INTEGER NOT NULL,
  callee_id INTEGER NOT NULL,
  kind TEXT NOT NULL DEFAULT 'audio',
  status TEXT NOT NULL DEFAULT 'ringing',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);