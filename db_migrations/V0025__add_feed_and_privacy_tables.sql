-- ══════════════════════════════════════════════════════════════
-- НАСТРОЙКИ ПРИВАТНОСТИ ПОЛЬЗОВАТЕЛЯ
-- ══════════════════════════════════════════════════════════════
ALTER TABLE users ADD COLUMN IF NOT EXISTS privacy_content VARCHAR(10) NOT NULL DEFAULT 'all';
ALTER TABLE users ADD COLUMN IF NOT EXISTS privacy_calls   VARCHAR(10) NOT NULL DEFAULT 'all';
ALTER TABLE users ADD COLUMN IF NOT EXISTS privacy_messages VARCHAR(10) NOT NULL DEFAULT 'all';

CREATE TABLE IF NOT EXISTS profile_content_allowed (
  owner_id  INT NOT NULL REFERENCES users(id),
  viewer_id INT NOT NULL REFERENCES users(id),
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  PRIMARY KEY (owner_id, viewer_id)
);

-- ══════════════════════════════════════════════════════════════
-- ЛЕНТА ПУБЛИКАЦИЙ (посты: фото / видео / текст)
-- ══════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS posts (
  id SERIAL PRIMARY KEY,
  user_id INT NOT NULL REFERENCES users(id),
  type VARCHAR(10) NOT NULL,
  content TEXT NOT NULL,
  caption TEXT,
  is_removed BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_posts_user ON posts(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_posts_created ON posts(created_at DESC);

CREATE TABLE IF NOT EXISTS post_likes (
  post_id INT NOT NULL REFERENCES posts(id),
  user_id INT NOT NULL REFERENCES users(id),
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  PRIMARY KEY (post_id, user_id)
);

CREATE TABLE IF NOT EXISTS post_comments (
  id SERIAL PRIMARY KEY,
  post_id INT NOT NULL REFERENCES posts(id),
  user_id INT NOT NULL REFERENCES users(id),
  text TEXT NOT NULL,
  reply_to_user_id INT REFERENCES users(id),
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_post_comments_post ON post_comments(post_id, created_at ASC);

CREATE TABLE IF NOT EXISTS post_views (
  post_id INT NOT NULL REFERENCES posts(id),
  user_id INT NOT NULL REFERENCES users(id),
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  PRIMARY KEY (post_id, user_id)
);
