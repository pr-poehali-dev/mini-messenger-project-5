CREATE TABLE IF NOT EXISTS statuses (
    id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id),
    type VARCHAR(10) NOT NULL CHECK (type IN ('text', 'photo', 'video')),
    content TEXT NOT NULL,
    caption TEXT,
    bg_color TEXT,
    created_at TIMESTAMP NOT NULL DEFAULT NOW(),
    expires_at TIMESTAMP NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_statuses_user ON statuses(user_id);
CREATE INDEX IF NOT EXISTS idx_statuses_expires ON statuses(expires_at);

CREATE TABLE IF NOT EXISTS status_views (
    id SERIAL PRIMARY KEY,
    status_id INTEGER NOT NULL REFERENCES statuses(id),
    viewer_id INTEGER NOT NULL REFERENCES users(id),
    viewed_at TIMESTAMP NOT NULL DEFAULT NOW(),
    UNIQUE(status_id, viewer_id)
);

CREATE INDEX IF NOT EXISTS idx_status_views_status ON status_views(status_id);
