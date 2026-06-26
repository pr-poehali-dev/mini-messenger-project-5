import json
import os
import hashlib
import psycopg2
from psycopg2.extras import RealDictCursor

ADMIN_EMAIL = 'muratdzaurov@mail.ru'
ADMIN_PASSWORD_HASH = hashlib.sha256('Original23061994'.encode()).hexdigest()
SCHEMA = os.environ.get('MAIN_DB_SCHEMA', 't_p93658230_mini_messenger_proje')

BOT_NICK = 'vaimessenger'
BOT_AD_NICK = 'vaimessenger_реклама'


def _conn():
    return psycopg2.connect(os.environ['DATABASE_URL'])


def _resp(status, body):
    return {
        'statusCode': status,
        'headers': {
            'Content-Type': 'application/json',
            'Access-Control-Allow-Origin': '*',
            'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
            'Access-Control-Allow-Headers': 'Content-Type, X-Admin-Token',
        },
        'isBase64Encoded': False,
        'body': json.dumps(body, default=str),
    }


def _check_auth(body: dict) -> bool:
    email = (body.get('email') or '').strip().lower()
    pw = hashlib.sha256((body.get('password') or '').encode()).hexdigest()
    return email == ADMIN_EMAIL and pw == ADMIN_PASSWORD_HASH


def _get_or_create_bot(cur, nick: str, display_nick: str) -> int:
    cur.execute(f"SELECT id FROM {SCHEMA}.users WHERE nick=%s", (nick,))
    row = cur.fetchone()
    if row:
        return row['id']
    cur.execute(
        f"INSERT INTO {SCHEMA}.users (nick, is_online, last_seen, profile_complete) VALUES (%s, FALSE, NOW(), TRUE) RETURNING id",
        (nick,)
    )
    return cur.fetchone()['id']


def handler(event: dict, context) -> dict:
    """Вай Мессенджер — Админ-панель"""
    if event.get('httpMethod') == 'OPTIONS':
        return _resp(200, {})

    params = event.get('queryStringParameters') or {}
    action = params.get('action', '')
    method = event.get('httpMethod', 'GET')

    try:
        body = json.loads(event.get('body') or '{}')
    except Exception:
        body = {}

    # ── Авторизация админа ──────────────────────────────────────────────────
    if action == 'login' and method == 'POST':
        if not _check_auth(body):
            return _resp(401, {'error': 'Неверный email или пароль'})
        return _resp(200, {'ok': True, 'token': ADMIN_PASSWORD_HASH[:16]})

    # Для всех остальных — проверяем токен в заголовке или теле
    token = (event.get('headers') or {}).get('X-Admin-Token', '') or body.get('token', '')
    if token != ADMIN_PASSWORD_HASH[:16]:
        return _resp(401, {'error': 'Не авторизован'})

    conn = _conn()
    try:
        cur = conn.cursor(cursor_factory=RealDictCursor)

        # ── Статистика ─────────────────────────────────────────────────────
        if action == 'stats' and method == 'GET':
            cur.execute(f"SELECT COUNT(*) AS total FROM {SCHEMA}.users WHERE nick NOT IN ('vaimessenger', 'vaimessenger_ad')")
            total_users = cur.fetchone()['total']
            cur.execute(f"SELECT COUNT(*) AS cnt FROM {SCHEMA}.users WHERE is_online=TRUE AND nick NOT IN ('vaimessenger', 'vaimessenger_ad')")
            online = cur.fetchone()['cnt']
            cur.execute(f"SELECT COUNT(*) AS cnt FROM {SCHEMA}.messages")
            total_messages = cur.fetchone()['cnt']
            cur.execute(f"SELECT COUNT(*) AS cnt FROM {SCHEMA}.chats")
            total_chats = cur.fetchone()['cnt']
            cur.execute(f"SELECT COUNT(*) AS cnt FROM {SCHEMA}.users WHERE created_at >= NOW() - INTERVAL '24 hours' AND nick NOT IN ('vaimessenger', 'vaimessenger_ad')")
            new_today = cur.fetchone()['cnt']
            cur.execute(f"SELECT COUNT(*) AS cnt FROM {SCHEMA}.users WHERE created_at >= NOW() - INTERVAL '7 days' AND nick NOT IN ('vaimessenger', 'vaimessenger_ad')")
            new_week = cur.fetchone()['cnt']
            return _resp(200, {
                'total_users': total_users,
                'online': online,
                'total_messages': total_messages,
                'total_chats': total_chats,
                'new_today': new_today,
                'new_week': new_week,
            })

        # ── Список пользователей ───────────────────────────────────────────
        if action == 'users' and method == 'GET':
            search = (params.get('q') or '').strip().lower()
            offset = int(params.get('offset') or 0)
            if search:
                cur.execute(
                    f"SELECT id, nick, avatar_url, city, about, is_online, last_seen, created_at FROM {SCHEMA}.users WHERE nick ILIKE %s AND nick NOT IN ('vaimessenger', 'vaimessenger_ad') ORDER BY created_at DESC LIMIT 50 OFFSET %s",
                    (f'%{search}%', offset)
                )
            else:
                cur.execute(
                    f"SELECT id, nick, avatar_url, city, about, is_online, last_seen, created_at FROM {SCHEMA}.users WHERE nick NOT IN ('vaimessenger', 'vaimessenger_ad') ORDER BY created_at DESC LIMIT 50 OFFSET %s",
                    (offset,)
                )
            users = cur.fetchall()
            cur.execute(f"SELECT COUNT(*) AS cnt FROM {SCHEMA}.users WHERE nick NOT IN ('vaimessenger', 'vaimessenger_ad')")
            total = cur.fetchone()['cnt']
            return _resp(200, {'users': users, 'total': total})

        # ── Удаление пользователя — полная чистка из всех таблиц ─────────────
        if action == 'delete_user' and method == 'POST':
            uid = int(body.get('user_id') or 0)
            if not uid:
                return _resp(400, {'error': 'user_id обязателен'})

            # 1. Находим все чаты пользователя (DM)
            cur.execute(
                f"SELECT id FROM {SCHEMA}.chats WHERE user_a=%s OR user_b=%s",
                (uid, uid)
            )
            chat_ids = [r['id'] for r in cur.fetchall()]

            # 2. Удаляем всё что связано с этими чатами
            for cid in chat_ids:
                cur.execute(f"DELETE FROM {SCHEMA}.message_reactions WHERE message_id IN (SELECT id FROM {SCHEMA}.messages WHERE chat_id=%s)", (cid,))
                cur.execute(f"DELETE FROM {SCHEMA}.messages WHERE chat_id=%s", (cid,))
                cur.execute(f"DELETE FROM {SCHEMA}.chat_reads WHERE chat_id=%s", (cid,))
                cur.execute(f"DELETE FROM {SCHEMA}.hidden_chats WHERE chat_id=%s", (cid,))
                cur.execute(f"DELETE FROM {SCHEMA}.typing_status WHERE chat_id=%s", (cid,))

            # 3. Удаляем сами чаты пользователя
            if chat_ids:
                cur.execute(f"DELETE FROM {SCHEMA}.chats WHERE user_a=%s OR user_b=%s", (uid, uid))

            # 4. Убираем из групп и групповые уведомления
            cur.execute(f"DELETE FROM {SCHEMA}.group_members WHERE user_id=%s", (uid,))

            # 5. Удаляем реакции, уведомления, подписки, блоки
            cur.execute(f"DELETE FROM {SCHEMA}.message_reactions WHERE user_id=%s", (uid,))
            cur.execute(f"DELETE FROM {SCHEMA}.notifications WHERE user_id=%s OR from_user_id=%s", (uid, uid))
            cur.execute(f"DELETE FROM {SCHEMA}.follows WHERE follower_id=%s OR following_id=%s", (uid, uid))
            cur.execute(f"DELETE FROM {SCHEMA}.blocks WHERE blocker_id=%s OR blocked_id=%s", (uid, uid))

            # 6. Звонки и сигналы
            cur.execute(f"DELETE FROM {SCHEMA}.call_signals WHERE from_user_id=%s OR to_user_id=%s", (uid, uid))
            cur.execute(f"DELETE FROM {SCHEMA}.active_calls WHERE caller_id=%s OR callee_id=%s", (uid, uid))

            # 7. Оставшиеся сообщения юзера в групповых чатах — помечаем как удалённые
            cur.execute(f"UPDATE {SCHEMA}.messages SET is_removed=TRUE, text='[удалено]' WHERE sender_id=%s", (uid,))

            # 8. Наконец удаляем самого пользователя
            cur.execute(f"DELETE FROM {SCHEMA}.users WHERE id=%s", (uid,))
            conn.commit()

            return _resp(200, {'ok': True})

        # ── Рассылка (broadcast) ───────────────────────────────────────────
        if action == 'broadcast' and method == 'POST':
            text = (body.get('text') or '').strip()
            image_url = body.get('image_url')
            is_ad = body.get('is_ad', False)  # True = реклама, False = системное
            if not text and not image_url:
                return _resp(400, {'error': 'Нужен текст или изображение'})

            bot_nick = 'vaimessenger_ad' if is_ad else 'vaimessenger'
            sender_name = 'ВайМессенджер Реклама' if is_ad else 'ВайМессенджер'

            bot_id = _get_or_create_bot(cur, bot_nick, sender_name)
            conn.commit()

            # Получаем всех активных пользователей
            cur.execute(
                f"SELECT id FROM {SCHEMA}.users WHERE nick NOT IN ('vaimessenger', 'vaimessenger_ad') AND id != %s",
                (bot_id,)
            )
            all_users = cur.fetchall()
            sent = 0

            for u in all_users:
                uid = u['id']
                # Находим или создаём чат с ботом
                cur.execute(
                    f"SELECT id FROM {SCHEMA}.chats WHERE (user_a=%s AND user_b=%s) OR (user_a=%s AND user_b=%s)",
                    (bot_id, uid, uid, bot_id)
                )
                chat = cur.fetchone()
                if not chat:
                    cur.execute(
                        f"INSERT INTO {SCHEMA}.chats (user_a, user_b) VALUES (%s, %s) RETURNING id",
                        (bot_id, uid)
                    )
                    chat = cur.fetchone()
                chat_id = chat['id']
                # Отправляем сообщение
                cur.execute(
                    f"INSERT INTO {SCHEMA}.messages (chat_id, sender_id, text, image_url) VALUES (%s, %s, %s, %s)",
                    (chat_id, bot_id, text or None, image_url or None)
                )
                sent += 1

            conn.commit()
            return _resp(200, {'ok': True, 'sent': sent})

        # ── Загрузка медиа ────────────────────────────────────────────────
        if action == 'upload_media' and method == 'POST':
            import boto3, base64
            data_b64 = body.get('data', '')
            ext = body.get('ext', 'jpg')
            content_type = 'image/jpeg' if ext in ('jpg', 'jpeg') else f'image/{ext}'
            raw = base64.b64decode(data_b64)
            s3 = boto3.client('s3',
                endpoint_url='https://bucket.poehali.dev',
                aws_access_key_id=os.environ['AWS_ACCESS_KEY_ID'],
                aws_secret_access_key=os.environ['AWS_SECRET_ACCESS_KEY']
            )
            import secrets as sec
            key = f'broadcast/{sec.token_hex(16)}.{ext}'
            s3.put_object(Bucket='files', Key=key, Body=raw, ContentType=content_type)
            url = f"https://cdn.poehali.dev/projects/{os.environ['AWS_ACCESS_KEY_ID']}/bucket/{key}"
            return _resp(200, {'url': url})

        return _resp(404, {'error': 'Неизвестное действие'})

    finally:
        conn.close()