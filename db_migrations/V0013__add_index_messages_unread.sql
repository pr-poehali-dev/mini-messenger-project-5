-- unread_count будет считаться динамически через запрос, без отдельной колонки
-- Добавляем индекс для быстрого подсчёта непрочитанных
CREATE INDEX IF NOT EXISTS idx_messages_chat_read ON messages(chat_id, is_read, sender_id);
