
CREATE TABLE IF NOT EXISTS realty_listings (
  id            SERIAL PRIMARY KEY,
  user_id       INT NOT NULL REFERENCES users(id),
  deal_type     TEXT NOT NULL,
  city          TEXT NOT NULL,
  district      TEXT,
  street        TEXT,
  rooms         INT,
  area          NUMERIC(8,1),
  price         BIGINT NOT NULL,
  description   TEXT,
  phone         TEXT,
  photos        TEXT[],
  is_paid       BOOLEAN NOT NULL DEFAULT FALSE,
  is_blocked    BOOLEAN NOT NULL DEFAULT FALSE,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS realty_chats (
  id            SERIAL PRIMARY KEY,
  listing_id    INT NOT NULL REFERENCES realty_listings(id),
  buyer_id      INT NOT NULL REFERENCES users(id),
  seller_id     INT NOT NULL REFERENCES users(id),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS realty_messages (
  id            SERIAL PRIMARY KEY,
  chat_id       INT NOT NULL REFERENCES realty_chats(id),
  sender_id     INT NOT NULL REFERENCES users(id),
  text          TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_realty_listings_user ON realty_listings(user_id);
CREATE INDEX IF NOT EXISTS idx_realty_listings_city ON realty_listings(city);
CREATE INDEX IF NOT EXISTS idx_realty_messages_chat ON realty_messages(chat_id);
