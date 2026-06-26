import json
import os
import secrets
import hashlib
import urllib.request
import psycopg2
from psycopg2.extras import RealDictCursor

ONESIGNAL_APP_ID = 'b50464b8-77e0-4bef-9897-aba0433d5f06'


def _hash_pw(password: str) -> str:
    return hashlib.sha256(password.encode()).hexdigest()


def _push(to_user_ids: list, title: str, body: str, url: str = '/') -> None:
    """Отправить push через OneSignal по external_id пользователей."""
    api_key = os.environ.get('ONESIGNAL_API_KEY', '')
    if not api_key or not to_user_ids:
        return
    try:
        payload = json.dumps({
            'app_id': ONESIGNAL_APP_ID,
            'include_aliases': {'external_id': [str(uid) for uid in to_user_ids]},
            'target_channel': 'push',
            'headings': {'ru': title, 'en': title},
            'contents': {'ru': body, 'en': body},
            'url': url,
            'ttl': 86400,
            'priority': 10,
        }).encode()
        req = urllib.request.Request(
            'https://api.onesignal.com/notifications',
            data=payload,
            headers={
                'Content-Type': 'application/json',
                'Authorization': f'Key {api_key}',
            },
            method='POST'
        )
        urllib.request.urlopen(req, timeout=5)
    except Exception:
        pass


def _conn():
    return psycopg2.connect(os.environ['DATABASE_URL'])


def _resp(status, body):
    return {
        'statusCode': status,
        'headers': {
            'Content-Type': 'application/json',
            'Access-Control-Allow-Origin': '*',
            'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
            'Access-Control-Allow-Headers': 'Content-Type, X-User-Id',
        },
        'isBase64Encoded': False,
        'body': json.dumps(body, default=str),
    }


def handler(event: dict, context) -> dict:
    """Вай Мессенджер: профили, чаты, группы, подписки"""
    if event.get('httpMethod') == 'OPTIONS':
        return _resp(200, {})

    params = event.get('queryStringParameters') or {}
    action = params.get('action', '')
    method = event.get('httpMethod', 'GET')

    try:
        body = json.loads(event.get('body') or '{}')
    except Exception:
        body = {}

    conn = _conn()
    try:
        cur = conn.cursor(cursor_factory=RealDictCursor)

        # ── AUTH ──────────────────────────────────────────
        if action == 'login' and method == 'POST':
            nick = (body.get('nick') or '').strip().lower()
            password = (body.get('password') or '').strip()
            device_id = (body.get('device_id') or '').strip()

            # Автовход по device_id (без ввода ника)
            if device_id and not nick:
                cur.execute(
                    "SELECT id, nick, profile_complete, avatar_url FROM users WHERE device_id = %s",
                    (device_id,)
                )
                by_device = cur.fetchone()
                if by_device:
                    cur.execute("UPDATE users SET is_online=TRUE, last_seen=NOW() WHERE id=%s", (by_device['id'],))
                    conn.commit()
                    return _resp(200, {'user': by_device})

            # Регистрация с ником + паролем
            if not nick or len(nick) < 2:
                return _resp(400, {'error': 'Введи ник'})
            if len(nick) > 30:
                return _resp(400, {'error': 'Ник максимум 30 символов'})
            if not password or len(password) < 4:
                return _resp(400, {'error': 'Пароль минимум 4 символа'})

            # Ник занят?
            cur.execute("SELECT id FROM users WHERE nick = %s", (nick,))
            if cur.fetchone():
                return _resp(409, {'error': 'Этот ник уже занят. Придумай другой.'})

            pw_hash = _hash_pw(password)
            cur.execute(
                "INSERT INTO users (nick, device_id, password_hash, is_online, last_seen, profile_complete) VALUES (%s, %s, %s, TRUE, NOW(), FALSE) RETURNING id, nick, profile_complete, avatar_url",
                (nick, device_id or None, pw_hash),
            )
            user = cur.fetchone()
            conn.commit()
            return _resp(200, {'user': user})

        # ── LOGIN BY NICK + PASSWORD ────────────────────────
        if action == 'login_by_nick' and method == 'POST':
            nick = (body.get('nick') or '').strip().lower()
            password = (body.get('password') or '').strip()
            device_id = (body.get('device_id') or '').strip()
            if not nick or len(nick) < 2:
                return _resp(400, {'error': 'Введи ник'})
            if not password:
                return _resp(400, {'error': 'Введи пароль'})
            cur.execute("SELECT id, nick, profile_complete, avatar_url, password_hash FROM users WHERE nick = %s", (nick,))
            found = cur.fetchone()
            if not found:
                return _resp(404, {'error': 'Аккаунт с таким ником не найден'})
            # Если пароль уже установлен — проверяем
            if found['password_hash'] and found['password_hash'] != _hash_pw(password):
                return _resp(401, {'error': 'Неверный пароль'})
            # Если пароль не был установлен — устанавливаем
            if not found['password_hash']:
                cur.execute("UPDATE users SET password_hash=%s WHERE id=%s", (_hash_pw(password), found['id']))
            if device_id:
                cur.execute("UPDATE users SET device_id=%s, is_online=TRUE, last_seen=NOW() WHERE id=%s", (device_id, found['id']))
            else:
                cur.execute("UPDATE users SET is_online=TRUE, last_seen=NOW() WHERE id=%s", (found['id'],))
            conn.commit()
            result = {'id': found['id'], 'nick': found['nick'], 'profile_complete': found['profile_complete'], 'avatar_url': found['avatar_url']}
            return _resp(200, {'user': result})

        # ── CHECK NICK ─────────────────────────────────────
        if action == 'check_nick' and method == 'GET':
            nick = (params.get('nick') or '').strip().lower()
            me = int(params.get('user_id') or 0)
            if not nick or len(nick) < 2:
                return _resp(200, {'available': False, 'error': 'Минимум 2 символа'})
            if len(nick) > 30:
                return _resp(200, {'available': False, 'error': 'Максимум 30 символов'})
            import re
            if not re.match(r'^[a-z0-9_]+$', nick):
                return _resp(200, {'available': False, 'error': 'Только латиница, цифры и _'})
            cur.execute("SELECT id FROM users WHERE nick = %s AND id != %s", (nick, me))
            taken = cur.fetchone()
            if taken:
                return _resp(200, {'available': False, 'error': 'Ник уже занят'})
            return _resp(200, {'available': True})

        # ── CHANGE NICK ────────────────────────────────────
        if action == 'change_nick' and method == 'POST':
            uid = int(body.get('user_id') or 0)
            new_nick = (body.get('nick') or '').strip().lower()
            if not new_nick or len(new_nick) < 2:
                return _resp(400, {'error': 'Ник минимум 2 символа'})
            if len(new_nick) > 30:
                return _resp(400, {'error': 'Ник максимум 30 символов'})
            import re
            if not re.match(r'^[a-z0-9_]+$', new_nick):
                return _resp(400, {'error': 'Только латиница, цифры и _'})
            cur.execute("SELECT id FROM users WHERE nick = %s AND id != %s", (new_nick, uid))
            if cur.fetchone():
                return _resp(409, {'error': 'Этот ник уже занят'})
            cur.execute(
                "UPDATE users SET nick=%s, nick_changed_at=NOW() WHERE id=%s RETURNING id, nick, avatar_url, profile_complete",
                (new_nick, uid),
            )
            user = cur.fetchone()
            conn.commit()
            return _resp(200, {'user': user})

        # ── PROFILE GET ───────────────────────────────────
        if action == 'profile' and method == 'GET':
            uid = int(params.get('user_id') or 0)
            me = int(params.get('me') or 0)
            cur.execute(
                """
                SELECT u.id, u.nick, u.avatar_url, u.city, u.birthdate, u.about, u.is_online, u.last_seen,
                       (SELECT COUNT(*) FROM follows WHERE following_id = u.id) AS followers,
                       (SELECT COUNT(*) FROM follows WHERE follower_id = u.id) AS following,
                       (SELECT TRUE FROM follows WHERE follower_id=%s AND following_id=u.id) AS i_follow,
                       (SELECT TRUE FROM blocks WHERE blocker_id=%s AND blocked_id=u.id) AS i_blocked
                FROM users u WHERE u.id=%s
                """,
                (me, me, uid),
            )
            user = cur.fetchone()
            if not user:
                return _resp(404, {'error': 'Не найден'})
            return _resp(200, {'user': user})

        # ── PROFILE UPDATE ────────────────────────────────
        if action == 'profile_update' and method == 'POST':
            uid = int(body.get('user_id') or 0)
            fields = {}
            for f in ('avatar_url', 'city', 'birthdate', 'about'):
                if f in body:
                    fields[f] = body[f] or None
            if not fields:
                return _resp(400, {'error': 'Нет данных'})
            fields['profile_complete'] = True
            set_clause = ', '.join(f"{k} = %s" for k in fields)
            cur.execute(
                f"UPDATE users SET {set_clause} WHERE id = %s RETURNING id, nick, avatar_url, city, birthdate, about, profile_complete",
                list(fields.values()) + [uid],
            )
            user = cur.fetchone()
            conn.commit()
            return _resp(200, {'user': user})

        # ── UPLOAD AVATAR ─────────────────────────────────
        if action == 'upload_avatar' and method == 'POST':
            import base64
            import boto3
            uid = int(body.get('user_id') or 0)
            data_b64 = body.get('data', '')
            ext = (body.get('ext') or 'jpg').lower()
            raw = base64.b64decode(data_b64)
            key = f"avatars/{uid}.{ext}"
            s3 = boto3.client(
                's3',
                endpoint_url='https://bucket.poehali.dev',
                aws_access_key_id=os.environ['AWS_ACCESS_KEY_ID'],
                aws_secret_access_key=os.environ['AWS_SECRET_ACCESS_KEY'],
            )
            s3.put_object(Bucket='files', Key=key, Body=raw, ContentType=f'image/{ext}')
            url = f"https://cdn.poehali.dev/projects/{os.environ['AWS_ACCESS_KEY_ID']}/bucket/{key}"
            cur.execute("UPDATE users SET avatar_url=%s, profile_complete=TRUE WHERE id=%s", (url, uid))
            conn.commit()
            return _resp(200, {'url': url})

        # ── SEARCH ───────────────────────────────────────
        if action == 'search' and method == 'GET':
            q = (params.get('q') or '').strip().lower()
            me = int(params.get('user_id') or 0)
            if not q:
                return _resp(200, {'users': []})
            cur.execute(
                """
                SELECT u.id, u.nick, u.avatar_url, u.city, u.is_online
                FROM users u
                WHERE u.nick LIKE %s AND u.id != %s
                  AND u.id NOT IN (SELECT blocked_id FROM blocks WHERE blocker_id=%s)
                ORDER BY u.nick LIMIT 20
                """,
                (f'%{q}%', me, me),
            )
            return _resp(200, {'users': cur.fetchall()})

        # ── FOLLOW / UNFOLLOW ─────────────────────────────
        if action == 'follow' and method == 'POST':
            me = int(body.get('user_id') or 0)
            target = int(body.get('target_id') or 0)
            cur.execute("INSERT INTO follows (follower_id, following_id) VALUES (%s, %s) ON CONFLICT DO NOTHING", (me, target))
            # Уведомление в БД
            cur.execute("INSERT INTO notifications (user_id, type, from_user_id) VALUES (%s, 'follow', %s)", (target, me))
            conn.commit()
            # Push
            cur.execute("SELECT nick FROM users WHERE id=%s", (me,))
            me_row = cur.fetchone()
            if me_row:
                _push([target], '👤 Новый подписчик', f'@{me_row["nick"]} подписался на вас', '/')
            return _resp(200, {'ok': True})

        if action == 'unfollow' and method == 'POST':
            me = int(body.get('user_id') or 0)
            target = int(body.get('target_id') or 0)
            cur.execute("DELETE FROM follows WHERE follower_id=%s AND following_id=%s", (me, target))
            conn.commit()
            return _resp(200, {'ok': True})

        # ── BLOCK / UNBLOCK ───────────────────────────────
        if action == 'block' and method == 'POST':
            me = int(body.get('user_id') or 0)
            target = int(body.get('target_id') or 0)
            cur.execute("INSERT INTO blocks (blocker_id, blocked_id) VALUES (%s, %s) ON CONFLICT DO NOTHING", (me, target))
            cur.execute(
                "DELETE FROM follows WHERE (follower_id=%s AND following_id=%s) OR (follower_id=%s AND following_id=%s)",
                (me, target, target, me),
            )
            conn.commit()
            return _resp(200, {'ok': True})

        if action == 'unblock' and method == 'POST':
            me = int(body.get('user_id') or 0)
            target = int(body.get('target_id') or 0)
            cur.execute("DELETE FROM blocks WHERE blocker_id=%s AND blocked_id=%s", (me, target))
            conn.commit()
            return _resp(200, {'ok': True})

        # ── FOLLOWERS / FOLLOWING ─────────────────────────
        if action == 'followers' and method == 'GET':
            uid = int(params.get('user_id') or 0)
            cur.execute(
                "SELECT u.id, u.nick, u.avatar_url, u.is_online FROM users u JOIN follows f ON f.follower_id=u.id WHERE f.following_id=%s",
                (uid,),
            )
            return _resp(200, {'users': cur.fetchall()})

        if action == 'following' and method == 'GET':
            uid = int(params.get('user_id') or 0)
            cur.execute(
                "SELECT u.id, u.nick, u.avatar_url, u.is_online FROM users u JOIN follows f ON f.following_id=u.id WHERE f.follower_id=%s",
                (uid,),
            )
            return _resp(200, {'users': cur.fetchall()})

        # ── CHATS LIST ────────────────────────────────────
        if action == 'chats' and method == 'GET':
            me = int(params.get('user_id') or 0)
            cur.execute(
                """
                SELECT c.id AS chat_id,
                       NULL::int AS group_id, NULL AS group_name, NULL AS group_avatar,
                       u.id AS peer_id, u.nick AS peer_nick, u.avatar_url AS peer_avatar, u.is_online AS peer_online,
                       (SELECT text FROM messages m WHERE m.chat_id=c.id AND m.is_removed=FALSE ORDER BY m.id DESC LIMIT 1) AS last_text,
                       (SELECT created_at FROM messages m WHERE m.chat_id=c.id AND m.is_removed=FALSE ORDER BY m.id DESC LIMIT 1) AS last_at,
                       'dm' AS kind,
                       (SELECT COUNT(*) FROM messages m WHERE m.chat_id=c.id AND m.is_removed=FALSE AND m.sender_id != %s AND m.id > COALESCE((SELECT last_read_id FROM chat_reads WHERE chat_id=c.id AND user_id=%s), 0)) AS unread_count
                FROM chats c
                JOIN users u ON u.id = CASE WHEN c.user_a=%s THEN c.user_b ELSE c.user_a END
                WHERE (c.user_a=%s OR c.user_b=%s) AND c.group_id IS NULL
                  AND c.id NOT IN (SELECT chat_id FROM hidden_chats WHERE user_id=%s)
                UNION ALL
                SELECT c.id AS chat_id,
                       g.id AS group_id, g.name AS group_name, g.avatar_url AS group_avatar,
                       NULL, NULL, NULL, NULL,
                       (SELECT text FROM messages m WHERE m.chat_id=c.id AND m.is_removed=FALSE ORDER BY m.id DESC LIMIT 1) AS last_text,
                       (SELECT created_at FROM messages m WHERE m.chat_id=c.id AND m.is_removed=FALSE ORDER BY m.id DESC LIMIT 1) AS last_at,
                       'group' AS kind,
                       (SELECT COUNT(*) FROM messages m WHERE m.chat_id=c.id AND m.is_removed=FALSE AND m.sender_id != %s AND m.id > COALESCE((SELECT last_read_id FROM chat_reads WHERE chat_id=c.id AND user_id=%s), 0)) AS unread_count
                FROM chats c
                JOIN groups g ON g.id=c.group_id
                JOIN group_members gm ON gm.group_id=g.id AND gm.user_id=%s
                WHERE c.id NOT IN (SELECT chat_id FROM hidden_chats WHERE user_id=%s)
                ORDER BY last_at DESC NULLS FIRST, chat_id DESC
                """,
                (me, me, me, me, me, me, me, me, me, me),
            )
            return _resp(200, {'chats': cur.fetchall()})

        # ── OPEN DM CHAT ──────────────────────────────────
        if action == 'open_chat' and method == 'POST':
            me = int(body.get('user_id') or 0)
            peer = int(body.get('peer_id') or 0)
            if not me or not peer or me == peer:
                return _resp(400, {'error': 'Некорректные пользователи'})
            a, b = min(me, peer), max(me, peer)
            cur.execute("SELECT id FROM chats WHERE user_a=%s AND user_b=%s AND group_id IS NULL", (a, b))
            row = cur.fetchone()
            if not row:
                cur.execute("INSERT INTO chats (user_a, user_b) VALUES (%s, %s) RETURNING id", (a, b))
                row = cur.fetchone()
            # Убираем из скрытых — если раньше удалял, теперь открывает снова
            cur.execute("DELETE FROM hidden_chats WHERE user_id=%s AND chat_id=%s", (me, row['id']))
            conn.commit()
            cur.execute("SELECT id, nick, avatar_url, is_online, last_seen FROM users WHERE id=%s", (peer,))
            peer_user = cur.fetchone()
            return _resp(200, {'chat_id': row['id'], 'peer': peer_user})

        # ── CREATE GROUP ──────────────────────────────────
        if action == 'create_group' and method == 'POST':
            me = int(body.get('user_id') or 0)
            name = (body.get('name') or '').strip()
            member_ids = body.get('member_ids') or []
            if not name:
                return _resp(400, {'error': 'Введи название группы'})
            token = secrets.token_urlsafe(12)
            cur.execute(
                "INSERT INTO groups (name, owner_id, invite_token) VALUES (%s, %s, %s) RETURNING id, invite_token",
                (name, me, token),
            )
            group = cur.fetchone()
            gid = group['id']
            # Для группового чата group_id определяет чат, user_a/user_b = создатель
            cur.execute("INSERT INTO chats (user_a, user_b, group_id) VALUES (%s, %s, %s) RETURNING id", (me, me, gid))
            chat = cur.fetchone()
            all_members = list({me} | {int(x) for x in member_ids})
            for uid in all_members:
                role = 'owner' if uid == me else 'member'
                cur.execute(
                    "INSERT INTO group_members (group_id, user_id, role) VALUES (%s, %s, %s) ON CONFLICT DO NOTHING",
                    (gid, uid, role),
                )
            conn.commit()
            return _resp(200, {'group_id': gid, 'chat_id': chat['id'], 'invite_token': group['invite_token']})

        # ── JOIN GROUP BY TOKEN ───────────────────────────
        if action == 'join_group' and method == 'POST':
            me = int(body.get('user_id') or 0)
            token = (body.get('token') or '').strip()
            cur.execute("SELECT id, name FROM groups WHERE invite_token=%s", (token,))
            group = cur.fetchone()
            if not group:
                return _resp(404, {'error': 'Ссылка недействительна'})
            gid = group['id']
            cur.execute("INSERT INTO group_members (group_id, user_id) VALUES (%s, %s) ON CONFLICT DO NOTHING", (gid, me))
            cur.execute("SELECT id FROM chats WHERE group_id=%s", (gid,))
            chat = cur.fetchone()
            conn.commit()
            return _resp(200, {'group_id': gid, 'chat_id': chat['id'], 'name': group['name']})

        # ── MESSAGES ──────────────────────────────────────
        if action == 'messages' and method == 'GET':
            chat_id = int(params.get('chat_id') or 0)
            after = int(params.get('after') or 0)
            me = int(params.get('user_id') or 0)
            cur.execute(
                """
                SELECT m.id, m.sender_id, u.nick AS sender_nick, u.avatar_url AS sender_avatar,
                       m.text, m.image_url, m.media_type, m.media_url, m.created_at,
                       m.is_removed, m.removed_by_sender, m.is_read,
                       COALESCE(
                           json_agg(json_build_object('emoji', r.emoji, 'user_id', r.user_id))
                           FILTER (WHERE r.message_id IS NOT NULL), '[]'
                       ) AS reactions
                FROM messages m
                JOIN users u ON u.id = m.sender_id
                LEFT JOIN message_reactions r ON r.message_id = m.id
                WHERE m.chat_id=%s AND m.id>%s
                  AND NOT (m.removed_by_sender = TRUE AND m.sender_id = %s)
                GROUP BY m.id, u.nick, u.avatar_url
                ORDER BY m.id ASC LIMIT 200
                """,
                (chat_id, after, me),
            )
            msgs = cur.fetchall()
            cur.execute(
                "UPDATE messages SET is_read=TRUE, read_at=NOW() WHERE chat_id=%s AND sender_id!=%s AND is_read=FALSE",
                (chat_id, me),
            )
            if msgs:
                max_id = max(m['id'] for m in msgs)
                cur.execute(
                    "INSERT INTO chat_reads (chat_id, user_id, last_read_id, updated_at) VALUES (%s, %s, %s, NOW()) ON CONFLICT (chat_id, user_id) DO UPDATE SET last_read_id=GREATEST(chat_reads.last_read_id, EXCLUDED.last_read_id), updated_at=NOW()",
                    (chat_id, me, max_id),
                )
            conn.commit()
            return _resp(200, {'messages': msgs})

        # ── READ STATUS (последнее прочитанное сообщение от меня) ─
        if action == 'read_status' and method == 'GET':
            chat_id = int(params.get('chat_id') or 0)
            me = int(params.get('user_id') or 0)
            cur.execute(
                "SELECT MAX(id) AS read_until FROM messages WHERE chat_id=%s AND sender_id=%s AND is_read=TRUE",
                (chat_id, me),
            )
            row = cur.fetchone()
            return _resp(200, {'read_until': row['read_until'] if row else None})

        # ── MARK READ ─────────────────────────────────────
        if action == 'mark_read' and method == 'POST':
            chat_id = int(body.get('chat_id') or 0)
            me = int(body.get('user_id') or 0)
            cur.execute(
                "UPDATE messages SET is_read=TRUE, read_at=NOW() WHERE chat_id=%s AND sender_id!=%s AND is_read=FALSE",
                (chat_id, me),
            )
            cur.execute("SELECT MAX(id) AS max_id FROM messages WHERE chat_id=%s", (chat_id,))
            max_row = cur.fetchone()
            max_id = max_row['max_id'] or 0
            cur.execute(
                "INSERT INTO chat_reads (chat_id, user_id, last_read_id, updated_at) VALUES (%s, %s, %s, NOW()) ON CONFLICT (chat_id, user_id) DO UPDATE SET last_read_id=EXCLUDED.last_read_id, updated_at=NOW()",
                (chat_id, me, max_id),
            )
            conn.commit()
            return _resp(200, {'ok': True})

        # ── REGISTER PUSH (сохраняем OneSignal external_id уже привязан, но на случай явного вызова) ──
        if action == 'register_push' and method == 'POST':
            uid = int(body.get('user_id') or 0)
            onesignal_id = (body.get('onesignal_id') or '').strip()
            if uid and onesignal_id:
                cur.execute("UPDATE users SET onesignal_id=%s WHERE id=%s", (onesignal_id, uid))
                conn.commit()
            return _resp(200, {'ok': True})

        # ── SEND MESSAGE ──────────────────────────────────
        if action == 'send' and method == 'POST':
            chat_id = int(body.get('chat_id') or 0)
            sender = int(body.get('user_id') or 0)
            text = body.get('text')
            image_url = body.get('image_url')
            media_type = body.get('media_type')
            media_url = body.get('media_url')
            if not chat_id or not sender or (not text and not image_url and not media_url):
                return _resp(400, {'error': 'Пустое сообщение'})
            cur.execute(
                """INSERT INTO messages (chat_id, sender_id, text, image_url, media_type, media_url)
                   VALUES (%s, %s, %s, %s, %s, %s)
                   RETURNING id, sender_id, text, image_url, media_type, media_url, created_at, is_removed""",
                (chat_id, sender, text, image_url, media_type, media_url),
            )
            msg = cur.fetchone()
            cur.execute("DELETE FROM typing_status WHERE chat_id=%s AND user_id=%s", (chat_id, sender))
            conn.commit()

            # Push: кому отправить (участники чата кроме отправителя)
            cur.execute("SELECT nick FROM users WHERE id=%s", (sender,))
            sender_row = cur.fetchone()
            sender_nick = sender_row['nick'] if sender_row else '?'
            # Определяем получателей
            cur.execute("SELECT user_a, user_b, group_id FROM chats WHERE id=%s", (chat_id,))
            chat_row = cur.fetchone()
            push_to = []
            if chat_row:
                if chat_row['group_id']:
                    # Групповой чат — всем участникам кроме отправителя
                    cur.execute("SELECT user_id FROM group_members WHERE group_id=%s AND user_id!=%s", (chat_row['group_id'], sender))
                    push_to = [r['user_id'] for r in cur.fetchall()]
                else:
                    # Личный чат
                    other = chat_row['user_b'] if chat_row['user_a'] == sender else chat_row['user_a']
                    push_to = [other]
            if push_to:
                preview = (text or '📷 Фото')[:60]
                _push(push_to, f'@{sender_nick}', preview, '/')

            return _resp(200, {'message': msg})

        # ── UPLOAD MEDIA ──────────────────────────────────
        if action == 'upload_media' and method == 'POST':
            import base64, boto3
            uid = int(body.get('user_id') or 0)
            data_b64 = body.get('data', '')
            ext = (body.get('ext') or 'jpg').lower()
            media_type = body.get('media_type', 'image')
            raw = base64.b64decode(data_b64)
            import time
            key = f"media/{uid}/{int(time.time())}.{ext}"
            ct_map = {'image': f'image/{ext}', 'video': f'video/{ext}', 'audio': f'audio/{ext}', 'voice': 'audio/ogg'}
            s3 = boto3.client('s3', endpoint_url='https://bucket.poehali.dev',
                aws_access_key_id=os.environ['AWS_ACCESS_KEY_ID'],
                aws_secret_access_key=os.environ['AWS_SECRET_ACCESS_KEY'])
            s3.put_object(Bucket='files', Key=key, Body=raw, ContentType=ct_map.get(media_type, 'application/octet-stream'))
            url = f"https://cdn.poehali.dev/projects/{os.environ['AWS_ACCESS_KEY_ID']}/bucket/{key}"
            return _resp(200, {'url': url, 'media_type': media_type})

        # ── REACT ─────────────────────────────────────────
        if action == 'react' and method == 'POST':
            msg_id = int(body.get('message_id') or 0)
            uid = int(body.get('user_id') or 0)
            emoji = (body.get('emoji') or '').strip()
            if not msg_id or not uid or not emoji:
                return _resp(400, {'error': 'Нет данных'})
            cur.execute("SELECT emoji FROM message_reactions WHERE message_id=%s AND user_id=%s", (msg_id, uid))
            existing = cur.fetchone()
            if existing and existing['emoji'] == emoji:
                cur.execute("DELETE FROM message_reactions WHERE message_id=%s AND user_id=%s", (msg_id, uid))
            else:
                cur.execute(
                    "INSERT INTO message_reactions (message_id, user_id, emoji) VALUES (%s, %s, %s) ON CONFLICT (message_id, user_id) DO UPDATE SET emoji=%s",
                    (msg_id, uid, emoji, emoji),
                )
            conn.commit()
            cur.execute(
                "SELECT emoji, user_id FROM message_reactions WHERE message_id=%s", (msg_id,)
            )
            return _resp(200, {'reactions': cur.fetchall()})

        # ── DELETE MESSAGE ────────────────────────────────
        if action == 'delete_message' and method == 'POST':
            msg_id = int(body.get('message_id') or 0)
            uid = int(body.get('user_id') or 0)
            for_all = body.get('for_all', False)
            cur.execute("SELECT sender_id FROM messages WHERE id=%s", (msg_id,))
            row = cur.fetchone()
            if not row:
                return _resp(404, {'error': 'Сообщение не найдено'})
            if for_all and row['sender_id'] == uid:
                cur.execute("UPDATE messages SET is_removed=TRUE WHERE id=%s", (msg_id,))
            else:
                cur.execute("UPDATE messages SET removed_by_sender=TRUE WHERE id=%s AND sender_id=%s", (msg_id, uid))
            conn.commit()
            return _resp(200, {'ok': True})

        # ── HIDE CHAT (только у себя) ──────────────────────
        if action == 'hide_chat' and method == 'POST':
            uid = int(body.get('user_id') or 0)
            chat_id = int(body.get('chat_id') or 0)
            cur.execute(
                "INSERT INTO hidden_chats (user_id, chat_id) VALUES (%s, %s) ON CONFLICT DO NOTHING",
                (uid, chat_id),
            )
            conn.commit()
            return _resp(200, {'ok': True})

        # ── DELETE CHAT (у всех — удаляет все сообщения) ──
        if action == 'delete_chat' and method == 'POST':
            uid = int(body.get('user_id') or 0)
            chat_id = int(body.get('chat_id') or 0)
            # Помечаем все сообщения как удалённые для всех
            cur.execute(
                "UPDATE messages SET is_removed=true, text=null, media_url=null WHERE chat_id=%s",
                (chat_id,)
            )
            # Скрываем чат у обоих участников
            cur.execute(
                """INSERT INTO hidden_chats (user_id, chat_id)
                   SELECT user_a, %s FROM chats WHERE id=%s
                   UNION
                   SELECT user_b, %s FROM chats WHERE id=%s
                   ON CONFLICT DO NOTHING""",
                (chat_id, chat_id, chat_id, chat_id)
            )
            conn.commit()
            return _resp(200, {'ok': True})

        # ── TYPING ───────────────────────────────────────
        if action == 'typing' and method == 'POST':
            chat_id = int(body.get('chat_id') or 0)
            uid = int(body.get('user_id') or 0)
            is_typing = body.get('typing', True)
            if is_typing:
                cur.execute(
                    "INSERT INTO typing_status (chat_id, user_id, updated_at) VALUES (%s, %s, NOW()) ON CONFLICT (chat_id, user_id) DO UPDATE SET updated_at=NOW()",
                    (chat_id, uid),
                )
            else:
                cur.execute("DELETE FROM typing_status WHERE chat_id=%s AND user_id=%s", (chat_id, uid))
            conn.commit()
            return _resp(200, {'ok': True})

        # ── CHAT STATUS ───────────────────────────────────
        if action == 'chat_status' and method == 'GET':
            chat_id = int(params.get('chat_id') or 0)
            me = int(params.get('user_id') or 0)
            cur.execute(
                """
                SELECT u.nick FROM typing_status ts
                JOIN users u ON u.id=ts.user_id
                WHERE ts.chat_id=%s AND ts.user_id!=%s
                  AND ts.updated_at > NOW() - INTERVAL '5 seconds'
                """,
                (chat_id, me),
            )
            typing = [r['nick'] for r in cur.fetchall()]
            return _resp(200, {'typing': typing})

        # ── PING / OFFLINE ───────────────────────────────
        if action == 'ping' and method == 'POST':
            uid = int(body.get('user_id') or 0)
            cur.execute("SELECT id FROM users WHERE id=%s", (uid,))
            if not cur.fetchone():
                # Пользователь удалён — сообщаем фронтенду разлогиниться
                return _resp(200, {'deleted': True})
            cur.execute("UPDATE users SET is_online=TRUE, last_seen=NOW() WHERE id=%s", (uid,))
            conn.commit()
            return _resp(200, {'ok': True})

        if action == 'offline' and method == 'POST':
            uid = int(body.get('user_id') or 0)
            cur.execute("UPDATE users SET is_online=FALSE, last_seen=NOW() WHERE id=%s", (uid,))
            conn.commit()
            return _resp(200, {'ok': True})

        # ── DELETE ACCOUNT ────────────────────────────────
        if action == 'delete_account' and method == 'POST':
            uid = int(body.get('user_id') or 0)
            if not uid:
                return _resp(400, {'error': 'Нет user_id'})
            # Удаляем все данные пользователя каскадно
            cur.execute("DELETE FROM typing_status WHERE user_id=%s", (uid,))
            cur.execute("DELETE FROM messages WHERE sender_id=%s", (uid,))
            cur.execute("DELETE FROM follows WHERE follower_id=%s OR following_id=%s", (uid, uid))
            cur.execute("DELETE FROM blocks WHERE blocker_id=%s OR blocked_id=%s", (uid, uid))
            cur.execute("DELETE FROM group_members WHERE user_id=%s", (uid,))
            # Чаты где пользователь один из участников (DM)
            cur.execute("DELETE FROM messages WHERE chat_id IN (SELECT id FROM chats WHERE user_a=%s OR user_b=%s)", (uid, uid))
            cur.execute("DELETE FROM chats WHERE user_a=%s OR user_b=%s", (uid, uid))
            # Удаляем пользователя — device_id тоже уходит
            cur.execute("DELETE FROM users WHERE id=%s", (uid,))
            conn.commit()
            return _resp(200, {'ok': True})

        # ── NOTIFICATIONS GET ─────────────────────────────
        if action == 'notifications' and method == 'GET':
            uid = int(params.get('user_id') or 0)
            cur.execute(
                """
                SELECT n.id, n.type, n.from_user_id, n.chat_id, n.group_id,
                       n.payload, n.is_read, n.created_at,
                       u.nick AS from_nick, u.avatar_url AS from_avatar
                FROM notifications n
                LEFT JOIN users u ON u.id = n.from_user_id
                WHERE n.user_id = %s
                ORDER BY n.created_at DESC LIMIT 50
                """,
                (uid,),
            )
            notifs = cur.fetchall()
            cur.execute("SELECT COUNT(*) AS cnt FROM notifications WHERE user_id=%s AND is_read=FALSE", (uid,))
            unread = cur.fetchone()['cnt']
            return _resp(200, {'notifications': notifs, 'unread': unread})

        # ── NOTIFICATIONS READ ────────────────────────────
        if action == 'notifications_read' and method == 'POST':
            uid = int(body.get('user_id') or 0)
            notif_id = body.get('notif_id')
            if notif_id:
                cur.execute("UPDATE notifications SET is_read=TRUE WHERE id=%s AND user_id=%s", (int(notif_id), uid))
            else:
                cur.execute("UPDATE notifications SET is_read=TRUE WHERE user_id=%s", (uid,))
            conn.commit()
            return _resp(200, {'ok': True})

        # ── NOTIFY (call missed) ──────────────────────────
        if action == 'notify_call' and method == 'POST':
            from_uid = int(body.get('from_user_id') or 0)
            to_uid = int(body.get('to_user_id') or 0)
            call_type = body.get('call_type', 'audio')
            a, b = min(from_uid, to_uid), max(from_uid, to_uid)
            cur.execute("SELECT id FROM chats WHERE user_a=%s AND user_b=%s AND group_id IS NULL", (a, b))
            chat_row = cur.fetchone()
            chat_id = chat_row['id'] if chat_row else None
            cur.execute(
                "INSERT INTO notifications (user_id, type, from_user_id, chat_id, payload) VALUES (%s, %s, %s, %s, %s)",
                (to_uid, 'missed_call', from_uid, chat_id, call_type),
            )
            conn.commit()
            # Push — пропущенный звонок
            cur.execute("SELECT nick FROM users WHERE id=%s", (from_uid,))
            caller = cur.fetchone()
            caller_nick = caller['nick'] if caller else '?'
            icon = '📹' if call_type == 'video' else '📞'
            _push([to_uid], f'{icon} Пропущенный звонок', f'@{caller_nick} звонил вам', '/')
            return _resp(200, {'ok': True})

        # ── GROUP INFO ────────────────────────────────────
        if action == 'group_info' and method == 'GET':
            gid = int(params.get('group_id') or 0)
            me = int(params.get('user_id') or 0)
            cur.execute(
                """
                SELECT g.id, g.name, g.about, g.photo_url, g.invite_token, g.owner_id, g.is_public,
                       (SELECT role FROM group_members WHERE group_id=g.id AND user_id=%s) AS my_role,
                       (SELECT COUNT(*) FROM group_members WHERE group_id=g.id) AS member_count
                FROM groups g WHERE g.id=%s
                """,
                (me, gid),
            )
            group = cur.fetchone()
            if not group:
                return _resp(404, {'error': 'Группа не найдена'})
            cur.execute(
                """
                SELECT u.id, u.nick, u.avatar_url, u.is_online, gm.role
                FROM group_members gm JOIN users u ON u.id=gm.user_id
                WHERE gm.group_id=%s ORDER BY gm.role DESC, u.nick
                """,
                (gid,),
            )
            members = cur.fetchall()
            # Подписчики владельца, кого ещё нет в группе
            cur.execute(
                """
                SELECT u.id, u.nick, u.avatar_url, u.is_online
                FROM follows f JOIN users u ON u.id = f.following_id
                WHERE f.follower_id = %s
                  AND u.id NOT IN (SELECT user_id FROM group_members WHERE group_id=%s)
                ORDER BY u.nick LIMIT 50
                """,
                (me, gid),
            )
            invitable = cur.fetchall()
            return _resp(200, {'group': group, 'members': members, 'invitable': invitable})

        # ── GROUP UPDATE ──────────────────────────────────
        if action == 'group_update' and method == 'POST':
            gid = int(body.get('group_id') or 0)
            uid = int(body.get('user_id') or 0)
            cur.execute("SELECT role FROM group_members WHERE group_id=%s AND user_id=%s", (gid, uid))
            row = cur.fetchone()
            if not row or row['role'] not in ('admin', 'owner'):
                return _resp(403, {'error': 'Нет прав'})
            fields = {}
            for f in ('name', 'about', 'photo_url'):
                if f in body:
                    fields[f] = body[f] or None
            if 'is_public' in body:
                fields['is_public'] = bool(body['is_public'])
            if not fields:
                return _resp(400, {'error': 'Нет данных'})
            set_clause = ', '.join(f"{k}=%s" for k in fields)
            cur.execute(f"UPDATE groups SET {set_clause} WHERE id=%s", list(fields.values()) + [gid])
            conn.commit()
            return _resp(200, {'ok': True})

        # ── GROUP REMOVE PHOTO ────────────────────────────
        if action == 'remove_group_photo' and method == 'POST':
            gid = int(body.get('group_id') or 0)
            uid = int(body.get('user_id') or 0)
            cur.execute("SELECT role FROM group_members WHERE group_id=%s AND user_id=%s", (gid, uid))
            r = cur.fetchone()
            if not r or r['role'] not in ('admin', 'owner'):
                return _resp(403, {'error': 'Нет прав'})
            cur.execute("UPDATE groups SET photo_url=NULL WHERE id=%s", (gid,))
            conn.commit()
            return _resp(200, {'ok': True})

        # ── GROUP ADD MEMBER ──────────────────────────────
        if action == 'group_add_member' and method == 'POST':
            gid = int(body.get('group_id') or 0)
            uid = int(body.get('user_id') or 0)
            target = int(body.get('target_id') or 0)
            cur.execute("SELECT role FROM group_members WHERE group_id=%s AND user_id=%s", (gid, uid))
            r = cur.fetchone()
            if not r or r['role'] not in ('admin', 'owner'):
                return _resp(403, {'error': 'Нет прав'})
            cur.execute(
                "INSERT INTO group_members (group_id, user_id, role) VALUES (%s, %s, 'member') ON CONFLICT DO NOTHING",
                (gid, target),
            )
            # Уведомление приглашённому
            cur.execute("SELECT id FROM chats WHERE group_id=%s", (gid,))
            chat_row = cur.fetchone()
            cur.execute(
                "INSERT INTO notifications (user_id, type, from_user_id, chat_id, group_id) VALUES (%s,'group_invite',%s,%s,%s)",
                (target, uid, chat_row['id'] if chat_row else None, gid),
            )
            conn.commit()
            return _resp(200, {'ok': True})

        # ── GROUP TRANSFER OWNER ──────────────────────────
        if action == 'group_transfer' and method == 'POST':
            gid = int(body.get('group_id') or 0)
            uid = int(body.get('user_id') or 0)
            new_owner = int(body.get('new_owner_id') or 0)
            cur.execute("SELECT owner_id FROM groups WHERE id=%s", (gid,))
            g = cur.fetchone()
            if not g or g['owner_id'] != uid:
                return _resp(403, {'error': 'Только владелец может передать права'})
            cur.execute("UPDATE groups SET owner_id=%s WHERE id=%s", (new_owner, gid))
            cur.execute("UPDATE group_members SET role='owner' WHERE group_id=%s AND user_id=%s", (gid, new_owner))
            cur.execute("UPDATE group_members SET role='member' WHERE group_id=%s AND user_id=%s", (gid, uid))
            conn.commit()
            return _resp(200, {'ok': True})

        # ── GROUP SET ROLE ────────────────────────────────
        if action == 'group_set_role' and method == 'POST':
            gid = int(body.get('group_id') or 0)
            uid = int(body.get('user_id') or 0)
            target = int(body.get('target_id') or 0)
            role = body.get('role', 'member')
            cur.execute("SELECT role FROM group_members WHERE group_id=%s AND user_id=%s", (gid, uid))
            r = cur.fetchone()
            if not r or r['role'] not in ('admin', 'owner'):
                return _resp(403, {'error': 'Нет прав'})
            cur.execute("UPDATE group_members SET role=%s WHERE group_id=%s AND user_id=%s", (role, gid, target))
            conn.commit()
            return _resp(200, {'ok': True})

        # ── GROUP KICK ────────────────────────────────────
        if action == 'group_kick' and method == 'POST':
            gid = int(body.get('group_id') or 0)
            uid = int(body.get('user_id') or 0)
            target = int(body.get('target_id') or 0)
            cur.execute("SELECT role FROM group_members WHERE group_id=%s AND user_id=%s", (gid, uid))
            r = cur.fetchone()
            if not r or r['role'] not in ('admin', 'owner'):
                return _resp(403, {'error': 'Нет прав'})
            cur.execute("DELETE FROM group_members WHERE group_id=%s AND user_id=%s", (gid, target))
            conn.commit()
            return _resp(200, {'ok': True})

        # ── GROUP LEAVE ───────────────────────────────────
        if action == 'group_leave' and method == 'POST':
            gid = int(body.get('group_id') or 0)
            uid = int(body.get('user_id') or 0)
            cur.execute("DELETE FROM group_members WHERE group_id=%s AND user_id=%s", (gid, uid))
            conn.commit()
            return _resp(200, {'ok': True})

        # ── UPLOAD GROUP PHOTO ────────────────────────────
        if action == 'upload_group_photo' and method == 'POST':
            import base64, boto3, time
            gid = int(body.get('group_id') or 0)
            uid = int(body.get('user_id') or 0)
            cur.execute("SELECT role FROM group_members WHERE group_id=%s AND user_id=%s", (gid, uid))
            r = cur.fetchone()
            if not r or r['role'] not in ('admin', 'owner'):
                return _resp(403, {'error': 'Нет прав'})
            data_b64 = body.get('data', '')
            ext = (body.get('ext') or 'jpg').lower()
            raw = base64.b64decode(data_b64)
            key = f"groups/{gid}/photo.{ext}"
            s3 = boto3.client('s3', endpoint_url='https://bucket.poehali.dev',
                aws_access_key_id=os.environ['AWS_ACCESS_KEY_ID'],
                aws_secret_access_key=os.environ['AWS_SECRET_ACCESS_KEY'])
            s3.put_object(Bucket='files', Key=key, Body=raw, ContentType=f'image/{ext}')
            url = f"https://cdn.poehali.dev/projects/{os.environ['AWS_ACCESS_KEY_ID']}/bucket/{key}?t={int(time.time())}"
            cur.execute("UPDATE groups SET photo_url=%s WHERE id=%s", (url, gid))
            conn.commit()
            return _resp(200, {'url': url})

        # ── CALL: начать звонок / отправить сигнал ────────
        if action == 'call_signal' and method == 'POST':
            """Отправка WebRTC сигнала (offer/answer/ice/ringing/reject/end)"""
            call_id   = body.get('call_id', '')
            from_uid  = int(body.get('from_user_id') or 0)
            to_uid    = int(body.get('to_user_id') or 0)
            sig_type  = body.get('type', '')
            payload   = body.get('payload', '')
            kind      = body.get('kind', 'audio')
            if not call_id or not from_uid or not to_uid or not sig_type:
                return _resp(400, {'error': 'Неверные параметры'})
            cur.execute(
                "INSERT INTO call_signals (call_id, from_user_id, to_user_id, type, payload) VALUES (%s,%s,%s,%s,%s)",
                (call_id, from_uid, to_uid, sig_type, payload)
            )
            if sig_type == 'offer':
                cur.execute(
                    """INSERT INTO active_calls (call_id, caller_id, callee_id, kind, status, updated_at)
                       VALUES (%s,%s,%s,%s,'ringing',NOW())
                       ON CONFLICT (call_id) DO UPDATE SET status='ringing', updated_at=NOW()""",
                    (call_id, from_uid, to_uid, kind)
                )
            elif sig_type in ('answer',):
                cur.execute("UPDATE active_calls SET status='active', updated_at=NOW() WHERE call_id=%s", (call_id,))
            elif sig_type in ('end', 'reject'):
                cur.execute("UPDATE active_calls SET status='ended', updated_at=NOW() WHERE call_id=%s", (call_id,))
            conn.commit()
            return _resp(200, {'ok': True})

        # ── CALL: ICE серверы для WebRTC ──────────────────
        if action == 'get_ice_servers' and method == 'GET':
            """Выдаёт TURN/STUN конфигурацию для WebRTC звонков"""
            turn_host = os.environ.get('TURN_HOST', '161.104.17.156')
            turn_user = os.environ.get('TURN_USER', 'vai')
            turn_pass = os.environ.get('TURN_PASS', '')
            return _resp(200, {
                'iceServers': [
                    {'urls': 'stun:stun.l.google.com:19302'},
                    {'urls': 'stun:stun.cloudflare.com:3478'},
                    {'urls': f'turn:{turn_host}:3478?transport=udp', 'username': turn_user, 'credential': turn_pass},
                    {'urls': f'turn:{turn_host}:3478?transport=tcp', 'username': turn_user, 'credential': turn_pass},
                ],
                'iceCandidatePoolSize': 10,
            })

        # ── CALL: опрос входящих сигналов ─────────────────
        if action == 'call_poll' and method == 'GET':
            """Получение новых WebRTC сигналов для пользователя"""
            me      = int(params.get('user_id') or 0)
            call_id = params.get('call_id', '')
            after   = int(params.get('after') or 0)
            if call_id:
                cur.execute(
                    "SELECT id, call_id, from_user_id, to_user_id, type, payload, created_at FROM call_signals WHERE call_id=%s AND to_user_id=%s AND id>%s ORDER BY id ASC",
                    (call_id, me, after)
                )
            else:
                cur.execute(
                    "SELECT id, call_id, from_user_id, to_user_id, type, payload, created_at FROM call_signals WHERE to_user_id=%s AND id>%s ORDER BY id ASC LIMIT 20",
                    (me, after)
                )
            signals = cur.fetchall()
            # Активный входящий звонок
            cur.execute(
                "SELECT ac.call_id, ac.caller_id, ac.kind, u.nick, u.avatar_url FROM active_calls ac JOIN users u ON u.id=ac.caller_id WHERE ac.callee_id=%s AND ac.status='ringing' ORDER BY ac.created_at DESC LIMIT 1",
                (me,)
            )
            incoming = cur.fetchone()
            return _resp(200, {'signals': signals, 'incoming': incoming})

        # ── CALL: статус звонка ────────────────────────────
        if action == 'call_status' and method == 'GET':
            call_id = params.get('call_id', '')
            cur.execute("SELECT status FROM active_calls WHERE call_id=%s", (call_id,))
            row = cur.fetchone()
            return _resp(200, {'status': row['status'] if row else 'ended'})

        return _resp(404, {'error': 'Неизвестное действие'})
    finally:
        conn.close()