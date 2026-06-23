-- Роли участников группы
ALTER TABLE group_members ADD COLUMN IF NOT EXISTS role TEXT DEFAULT 'member';

-- Описание и фото группы
ALTER TABLE groups ADD COLUMN IF NOT EXISTS about TEXT;
ALTER TABLE groups ADD COLUMN IF NOT EXISTS photo_url TEXT;

-- Уведомления
CREATE TABLE IF NOT EXISTS notifications (
    id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL,
    type TEXT NOT NULL,
    from_user_id INTEGER,
    chat_id INTEGER,
    group_id INTEGER,
    payload TEXT,
    is_read BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMP DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_notifications_user ON notifications(user_id, is_read, created_at DESC);
