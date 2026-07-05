CREATE TABLE IF NOT EXISTS t_p93658230_mini_messenger_proje.broadcasts (
    id SERIAL PRIMARY KEY,
    is_ad BOOLEAN NOT NULL DEFAULT FALSE,
    text TEXT,
    image_url TEXT,
    sent_count INTEGER NOT NULL DEFAULT 0,
    created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

ALTER TABLE t_p93658230_mini_messenger_proje.messages
    ADD COLUMN IF NOT EXISTS broadcast_id INTEGER NULL REFERENCES t_p93658230_mini_messenger_proje.broadcasts(id);

CREATE INDEX IF NOT EXISTS idx_messages_broadcast_id ON t_p93658230_mini_messenger_proje.messages(broadcast_id);
