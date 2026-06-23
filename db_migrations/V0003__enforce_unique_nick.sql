-- Гарантируем уникальность ника (на случай если индекс не создан)
CREATE UNIQUE INDEX IF NOT EXISTS idx_users_nick_unique ON users(nick);

-- Добавляем поле для смены ника с историей
ALTER TABLE users ADD COLUMN IF NOT EXISTS nick_changed_at TIMESTAMP;
