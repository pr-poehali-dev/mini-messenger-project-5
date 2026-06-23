CREATE TABLE IF NOT EXISTS hidden_chats (
    user_id INTEGER NOT NULL,
    chat_id INTEGER NOT NULL,
    hidden_at TIMESTAMP DEFAULT NOW(),
    PRIMARY KEY (user_id, chat_id)
);
