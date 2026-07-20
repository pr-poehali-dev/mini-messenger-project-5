-- Новые поля для email-регистрации, согласий, телефона, защиты от взлома
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS email TEXT,
  ADD COLUMN IF NOT EXISTS first_name TEXT,
  ADD COLUMN IF NOT EXISTS last_name TEXT,
  ADD COLUMN IF NOT EXISTS phone TEXT,
  ADD COLUMN IF NOT EXISTS consent_152 BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS consent_terms BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS consent_rules BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS consent_at TIMESTAMP,
  ADD COLUMN IF NOT EXISTS consent_ip TEXT,
  ADD COLUMN IF NOT EXISTS failed_attempts INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS locked_until TIMESTAMP,
  ADD COLUMN IF NOT EXISTS reset_code TEXT,
  ADD COLUMN IF NOT EXISTS reset_code_expires TIMESTAMP;

CREATE UNIQUE INDEX IF NOT EXISTS users_email_unique_idx ON users (email) WHERE email IS NOT NULL;

-- Закреплённые чаты (свайп вправо)
CREATE TABLE IF NOT EXISTS chat_pins (
  user_id INTEGER NOT NULL,
  chat_id INTEGER NOT NULL,
  pinned_at TIMESTAMP NOT NULL DEFAULT NOW(),
  PRIMARY KEY (user_id, chat_id)
);

-- Ответ на сообщение (цитирование)
ALTER TABLE messages ADD COLUMN IF NOT EXISTS reply_to_id INTEGER REFERENCES messages(id);
