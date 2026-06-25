CREATE TABLE IF NOT EXISTS chat_reads (
    chat_id INTEGER NOT NULL,
    user_id INTEGER NOT NULL,
    last_read_id INTEGER NOT NULL DEFAULT 0,
    updated_at TIMESTAMP DEFAULT NOW(),
    PRIMARY KEY (chat_id, user_id)
);
