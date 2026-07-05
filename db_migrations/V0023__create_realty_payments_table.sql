CREATE TABLE IF NOT EXISTS realty_payments (
    id SERIAL PRIMARY KEY,
    listing_id INTEGER NOT NULL REFERENCES realty_listings(id),
    user_id INTEGER NOT NULL REFERENCES users(id),
    yookassa_payment_id TEXT NOT NULL UNIQUE,
    amount NUMERIC(10,2) NOT NULL DEFAULT 50.00,
    status VARCHAR(20) NOT NULL DEFAULT 'pending',
    payment_method VARCHAR(20),
    confirmation_url TEXT,
    created_at TIMESTAMP NOT NULL DEFAULT NOW(),
    paid_at TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_realty_payments_listing ON realty_payments(listing_id);
CREATE INDEX IF NOT EXISTS idx_realty_payments_yk_id ON realty_payments(yookassa_payment_id);
