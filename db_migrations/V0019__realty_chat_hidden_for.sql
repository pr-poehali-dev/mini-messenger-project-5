ALTER TABLE realty_chats ADD COLUMN IF NOT EXISTS hidden_for_users INT[] NOT NULL DEFAULT '{}';
