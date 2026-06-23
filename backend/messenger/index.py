import json
import os
import psycopg2
from psycopg2.extras import RealDictCursor


def _conn():
    return psycopg2.connect(os.environ['DATABASE_URL'])


def _resp(status, body):
    return {
        'statusCode': status,
        'headers': {
            'Content-Type': 'application/json',
            'Access-Control-Allow-Origin': '*',
            'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
            'Access-Control-Allow-Headers': 'Content-Type, X-User-Id, X-Auth-Token, X-Session-Id',
        },
        'isBase64Encoded': False,
        'body': json.dumps(body),
    }


def handler(event: dict, context) -> dict:
    '''Мессенджер: регистрация по нику, поиск людей, чаты и сообщения'''
    method = event.get('httpMethod', 'GET')
    if method == 'OPTIONS':
        return _resp(200, {})

    params = event.get('queryStringParameters') or {}
    action = params.get('action', '')

    try:
        body = json.loads(event.get('body') or '{}')
    except Exception:
        body = {}

    conn = _conn()
    try:
        cur = conn.cursor(cursor_factory=RealDictCursor)

        if method == 'POST' and action == 'login':
            nick = (body.get('nick') or '').strip().lower()
            if not nick or len(nick) < 2:
                return _resp(400, {'error': 'Ник минимум 2 символа'})
            cur.execute("SELECT id, nick FROM users WHERE nick = %s", (nick,))
            user = cur.fetchone()
            if not user:
                cur.execute(
                    "INSERT INTO users (nick) VALUES (%s) RETURNING id, nick",
                    (nick,),
                )
                user = cur.fetchone()
                conn.commit()
            return _resp(200, {'user': user})

        if method == 'GET' and action == 'search':
            q = (params.get('q') or '').strip().lower()
            me = int(params.get('user_id') or 0)
            if not q:
                return _resp(200, {'users': []})
            cur.execute(
                "SELECT id, nick FROM users WHERE nick LIKE %s AND id != %s ORDER BY nick LIMIT 20",
                (f'%{q}%', me),
            )
            return _resp(200, {'users': cur.fetchall()})

        if method == 'GET' and action == 'chats':
            me = int(params.get('user_id') or 0)
            cur.execute(
                """
                SELECT c.id AS chat_id,
                       u.id AS peer_id,
                       u.nick AS peer_nick,
                       (SELECT text FROM messages m WHERE m.chat_id = c.id ORDER BY m.id DESC LIMIT 1) AS last_text,
                       (SELECT image_url FROM messages m WHERE m.chat_id = c.id ORDER BY m.id DESC LIMIT 1) AS last_image,
                       (SELECT created_at FROM messages m WHERE m.chat_id = c.id ORDER BY m.id DESC LIMIT 1) AS last_at
                FROM chats c
                JOIN users u ON u.id = CASE WHEN c.user_a = %s THEN c.user_b ELSE c.user_a END
                WHERE c.user_a = %s OR c.user_b = %s
                ORDER BY last_at DESC NULLS LAST
                """,
                (me, me, me),
            )
            return _resp(200, {'chats': cur.fetchall()})

        if method == 'POST' and action == 'open_chat':
            me = int(body.get('user_id') or 0)
            peer = int(body.get('peer_id') or 0)
            if not me or not peer or me == peer:
                return _resp(400, {'error': 'Некорректные пользователи'})
            a, b = min(me, peer), max(me, peer)
            cur.execute(
                "SELECT id FROM chats WHERE user_a = %s AND user_b = %s",
                (a, b),
            )
            row = cur.fetchone()
            if not row:
                cur.execute(
                    "INSERT INTO chats (user_a, user_b) VALUES (%s, %s) RETURNING id",
                    (a, b),
                )
                row = cur.fetchone()
                conn.commit()
            cur.execute("SELECT id, nick FROM users WHERE id = %s", (peer,))
            peer_user = cur.fetchone()
            return _resp(200, {'chat_id': row['id'], 'peer': peer_user})

        if method == 'GET' and action == 'messages':
            chat_id = int(params.get('chat_id') or 0)
            after = int(params.get('after') or 0)
            cur.execute(
                """
                SELECT id, sender_id, text, image_url, created_at
                FROM messages
                WHERE chat_id = %s AND id > %s
                ORDER BY id ASC LIMIT 200
                """,
                (chat_id, after),
            )
            return _resp(200, {'messages': cur.fetchall()})

        if method == 'POST' and action == 'send':
            chat_id = int(body.get('chat_id') or 0)
            sender = int(body.get('user_id') or 0)
            text = body.get('text')
            image_url = body.get('image_url')
            if not chat_id or not sender or (not text and not image_url):
                return _resp(400, {'error': 'Пустое сообщение'})
            cur.execute(
                """
                INSERT INTO messages (chat_id, sender_id, text, image_url)
                VALUES (%s, %s, %s, %s)
                RETURNING id, sender_id, text, image_url, created_at
                """,
                (chat_id, sender, text, image_url),
            )
            msg = cur.fetchone()
            conn.commit()
            return _resp(200, {'message': msg})

        return _resp(404, {'error': 'Неизвестное действие'})
    finally:
        conn.close()
