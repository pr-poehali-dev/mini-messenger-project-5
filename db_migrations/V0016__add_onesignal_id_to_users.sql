ALTER TABLE t_p93658230_mini_messenger_proje.users
  ADD COLUMN IF NOT EXISTS onesignal_id TEXT;

CREATE INDEX IF NOT EXISTS idx_users_onesignal_id
  ON t_p93658230_mini_messenger_proje.users(onesignal_id)
  WHERE onesignal_id IS NOT NULL;
