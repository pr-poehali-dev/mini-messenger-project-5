ALTER TABLE users ADD COLUMN IF NOT EXISTS is_verified BOOLEAN NOT NULL DEFAULT FALSE;
UPDATE users SET is_verified = TRUE WHERE nick = 'murat_dzaurov';
