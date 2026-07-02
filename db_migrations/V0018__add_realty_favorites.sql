CREATE TABLE IF NOT EXISTS realty_favorites (
  user_id    INT NOT NULL REFERENCES users(id),
  listing_id INT NOT NULL REFERENCES realty_listings(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (user_id, listing_id)
);
CREATE INDEX IF NOT EXISTS idx_realty_fav_user ON realty_favorites(user_id);
