ALTER TABLE chats DROP CONSTRAINT chats_user_a_user_b_key;
CREATE UNIQUE INDEX IF NOT EXISTS idx_chats_dm_unique ON chats(user_a, user_b) WHERE group_id IS NULL;
