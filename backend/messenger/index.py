import json
import os
import re
import time
import secrets
import hashlib
import base64
import smtplib
import random
import urllib.request
from email.mime.text import MIMEText
from datetime import datetime, timedelta
import psycopg2
import boto3
import requests
from psycopg2.extras import RealDictCursor

EMAIL_RE = re.compile(r'^[^@\s]+@[^@\s]+\.[^@\s]+$')

ONESIGNAL_APP_ID = 'b50464b8-77e0-4bef-9897-aba0433d5f06'

REGRU_BUCKET = 'files'

YOOKASSA_SHOP_ID = '1398898'
YOOKASSA_API_URL = 'https://api.yookassa.ru/v3/payments'


def _yookassa_create_payment(amount: str, description: str, return_url: str, metadata: dict, user_id: int) -> dict:
    """Создаёт платёж в ЮKassa со способом оплаты СБП/T-Pay, возвращает JSON ответа."""
    secret_key = os.environ['YOOKASSA_SECRET_KEY']
    idempotence_key = secrets.token_hex(16)
    resp = requests.post(
        YOOKASSA_API_URL,
        json={
            'amount': {'value': amount, 'currency': 'RUB'},
            'confirmation': {'type': 'redirect', 'return_url': return_url},
            'capture': True,
            'description': description,
            'metadata': metadata,
            'receipt': {
                'customer': {'email': f'user{user_id}@vaimessenger.ru'},
                'items': [{
                    'description': description[:128],
                    'quantity': '1.00',
                    'amount': {'value': amount, 'currency': 'RUB'},
                    'vat_code': 1,
                    'payment_subject': 'service',
                    'payment_mode': 'full_payment',
                }],
            },
        },
        auth=(YOOKASSA_SHOP_ID, secret_key),
        headers={'Idempotence-Key': idempotence_key, 'Content-Type': 'application/json'},
        timeout=15,
    )
    if not resp.ok:
        print(f'[YOOKASSA] HTTP {resp.status_code} body: {resp.text}')
    resp.raise_for_status()
    return resp.json()


def _yookassa_get_payment(payment_id: str) -> dict:
    """Запрашивает текущий статус платежа по его ID."""
    secret_key = os.environ['YOOKASSA_SECRET_KEY']
    resp = requests.get(
        f'{YOOKASSA_API_URL}/{payment_id}',
        auth=(YOOKASSA_SHOP_ID, secret_key),
        timeout=15,
    )
    resp.raise_for_status()
    return resp.json()

def _s3():
    return boto3.client(
        's3',
        endpoint_url='https://bucket.poehali.dev',
        aws_access_key_id=os.environ['AWS_ACCESS_KEY_ID'],
        aws_secret_access_key=os.environ['AWS_SECRET_ACCESS_KEY'],
    )

def _s3_url(key: str) -> str:
    return f"https://cdn.poehali.dev/projects/{os.environ['AWS_ACCESS_KEY_ID']}/bucket/{key}"


def _hash_pw(password: str) -> str:
    return hashlib.sha256(password.encode()).hexdigest()


def _send_reset_code(to_email: str, code: str) -> bool:
    """Отправляет 4-значный код восстановления пароля на почту."""
    host = os.environ.get('SMTP_HOST', '')
    user = os.environ.get('SMTP_USER', '')
    pwd = os.environ.get('SMTP_PASS', '')
    if not host or not user or not pwd:
        print('[SMTP] нет настроек SMTP — код не отправлен')
        return False
    try:
        msg = MIMEText(f'Ваш код для восстановления пароля в Вай Чат: {code}\nКод действителен 2 минуты.', 'plain', 'utf-8')
        msg['Subject'] = 'Код восстановления пароля — Вай Чат'
        msg['From'] = user
        msg['To'] = to_email
        with smtplib.SMTP_SSL(host, 465, timeout=10) as server:
            server.login(user, pwd)
            server.sendmail(user, [to_email], msg.as_string())
        return True
    except Exception as e:
        print(f'[SMTP] Ошибка отправки: {e}')
        return False


def _push(to_user_ids: list, title: str, body: str, url: str = '/') -> dict:
    """Отправить push через OneSignal по external_id пользователей."""
    api_key = os.environ.get('ONESIGNAL_API_KEY', '')
    if not api_key:
        print('[PUSH] ONESIGNAL_API_KEY не задан')
        return {'error': 'no_key'}
    if not to_user_ids:
        return {'error': 'no_recipients'}
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
        resp = urllib.request.urlopen(req, timeout=8)
        result = json.loads(resp.read().decode())
        print(f'[PUSH] OK → {result}')
        return result
    except urllib.error.HTTPError as e:
        err = e.read().decode()
        print(f'[PUSH] HTTP Error {e.code}: {err}')
        return {'error': err}
    except Exception as e:
        print(f'[PUSH] Exception: {e}')
        return {'error': str(e)}


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

    # ── UPLOAD CHUNK — обрабатываем ДО json парсинга (raw binary) ──
    if action == 'upload_chunk' and method == 'POST':
        uid       = int(params.get('user_id') or 0)
        upload_id = params.get('upload_id', '')
        chunk_idx = int(params.get('chunk_index') or 0)
        raw_b = event.get('body') or ''
        if not upload_id or not raw_b:
            return _resp(400, {'error': 'Нет данных'})
        if event.get('isBase64Encoded'):
            raw = base64.b64decode(raw_b)
        else:
            raw = raw_b.encode('latin-1') if isinstance(raw_b, str) else raw_b
        key = f"chunks/{uid}/{upload_id}/{chunk_idx:05d}"
        s3 = _s3()
        s3.put_object(Bucket=REGRU_BUCKET, Key=key, Body=raw)
        print(f'[CHUNK] uid={uid} upload_id={upload_id} chunk={chunk_idx} size={len(raw)}')
        return _resp(200, {'ok': True})

    try:
        raw_body = event.get('body') or '{}'
        if event.get('isBase64Encoded'):
            raw_body = base64.b64decode(raw_body).decode('utf-8')
        body = json.loads(raw_body)
    except Exception as e:
        print(f'[BODY PARSE ERROR] {e}')
        body = {}

    conn = _conn()
    try:
        cur = conn.cursor(cursor_factory=RealDictCursor)

        def _privacy_allows(owner_id: int, viewer_id: int, field: str) -> bool:
            """Проверка privacy_calls / privacy_messages: может ли viewer связаться с owner."""
            if owner_id == viewer_id:
                return True
            cur.execute(f"SELECT {field} AS mode FROM users WHERE id=%s", (owner_id,))
            row = cur.fetchone()
            mode = row['mode'] if row else 'all'
            if mode == 'all':
                return True
            cur.execute("SELECT 1 FROM follows WHERE follower_id=%s AND following_id=%s", (viewer_id, owner_id))
            return cur.fetchone() is not None

        # ── AUTH: автовход по device_id (тихий вход при повторном открытии) ──
        if action == 'auth_check_device' and method == 'POST':
            device_id = (body.get('device_id') or '').strip()
            if not device_id:
                return _resp(200, {'user': None})
            cur.execute(
                "SELECT id, nick, first_name, last_name, profile_complete, avatar_url, is_verified FROM users WHERE device_id = %s",
                (device_id,)
            )
            by_device = cur.fetchone()
            if by_device:
                cur.execute("UPDATE users SET is_online=TRUE, last_seen=NOW() WHERE id=%s", (by_device['id'],))
                conn.commit()
                return _resp(200, {'user': by_device})
            return _resp(200, {'user': None})

        # ── REGISTER: email + пароль + профиль (создаётся сразу целиком) ───
        if action == 'register' and method == 'POST':
            email = (body.get('email') or '').strip().lower()
            password = (body.get('password') or '').strip()
            first_name = (body.get('first_name') or '').strip()
            last_name = (body.get('last_name') or '').strip()
            city = (body.get('city') or '').strip()
            birthdate = (body.get('birthdate') or '').strip()
            about = (body.get('about') or '').strip()[:150]
            phone = (body.get('phone') or '').strip()
            avatar_url = body.get('avatar_url') or None
            device_id = (body.get('device_id') or '').strip()
            consent_152 = bool(body.get('consent_152'))
            consent_terms = bool(body.get('consent_terms'))
            consent_rules = bool(body.get('consent_rules'))

            if not EMAIL_RE.match(email) or not email.endswith('@mail.ru'):
                return _resp(400, {'error': 'Регистрация доступна только с почтой @mail.ru'})
            if not password or len(password) < 6:
                return _resp(400, {'error': 'Пароль минимум 6 символов'})
            if not first_name or len(first_name) < 2 or not last_name or len(last_name) < 2:
                return _resp(400, {'error': 'Введи имя и фамилию'})
            if not city:
                return _resp(400, {'error': 'Выбери город'})
            if not birthdate:
                return _resp(400, {'error': 'Укажи дату рождения'})
            try:
                bd = datetime.strptime(birthdate, '%Y-%m-%d')
                age = (datetime.now() - bd).days // 365
                if age < 14:
                    return _resp(400, {'error': 'Регистрация доступна с 14 лет'})
            except ValueError:
                return _resp(400, {'error': 'Некорректная дата рождения'})
            phone_digits = re.sub(r'\D', '', phone)
            if len(phone_digits) < 11:
                return _resp(400, {'error': 'Укажи телефон полностью'})
            if not (consent_152 and consent_terms and consent_rules):
                return _resp(400, {'error': 'Нужно принять все условия'})

            cur.execute("SELECT id FROM users WHERE email=%s", (email,))
            if cur.fetchone():
                return _resp(409, {'error': 'Аккаунт с такой почтой уже существует'})
            cur.execute("SELECT id FROM users WHERE phone=%s", (phone_digits,))
            if cur.fetchone():
                return _resp(409, {'error': 'Этот номер телефона уже используется'})

            base_nick = re.sub(r'[^a-z0-9_]', '', email.split('@')[0].lower()) or 'user'
            nick = base_nick
            suffix = 0
            while True:
                cur.execute("SELECT id FROM users WHERE nick=%s", (nick,))
                if not cur.fetchone():
                    break
                suffix += 1
                nick = f'{base_nick}{suffix}'

            # Освобождаем device_id от старых/незавершённых аккаунтов — иначе конфликт уникального индекса
            if device_id:
                cur.execute("UPDATE users SET device_id=NULL WHERE device_id=%s", (device_id,))

            source_ip = (event.get('requestContext', {}).get('identity', {}) or {}).get('sourceIp', '')
            pw_hash = _hash_pw(password)
            cur.execute(
                """INSERT INTO users (nick, email, password_hash, first_name, last_name, city, birthdate, about, phone,
                       device_id, is_online, last_seen, profile_complete,
                       consent_152, consent_terms, consent_rules, consent_at, consent_ip, avatar_url)
                   VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,TRUE,NOW(),TRUE,%s,%s,%s,NOW(),%s,%s)
                   RETURNING id, nick, first_name, last_name, profile_complete, avatar_url, is_verified""",
                (nick, email, pw_hash, first_name, last_name, city, birthdate, about, phone_digits,
                 device_id or None, consent_152, consent_terms, consent_rules, source_ip, avatar_url),
            )
            user = cur.fetchone()
            conn.commit()
            return _resp(200, {'user': user})

        # ── LOGIN: email + пароль (с защитой от подбора) ────────────────────
        if action == 'login_email' and method == 'POST':
            email = (body.get('email') or '').strip().lower()
            password = (body.get('password') or '').strip()
            device_id = (body.get('device_id') or '').strip()
            if not EMAIL_RE.match(email):
                return _resp(400, {'error': 'Введи корректную почту'})
            if not password:
                return _resp(400, {'error': 'Введи пароль'})
            cur.execute(
                "SELECT id, nick, first_name, last_name, profile_complete, avatar_url, password_hash, is_verified, failed_attempts, locked_until FROM users WHERE email=%s",
                (email,)
            )
            found = cur.fetchone()
            if not found:
                return _resp(404, {'error': 'Аккаунт с такой почтой не найден'})
            if found['locked_until'] and found['locked_until'] > datetime.now():
                remain = int((found['locked_until'] - datetime.now()).total_seconds() // 60) + 1
                return _resp(423, {'error': f'Слишком много попыток. Попробуй через {remain} мин.'})
            if found['password_hash'] != _hash_pw(password):
                attempts = (found['failed_attempts'] or 0) + 1
                if attempts >= 3:
                    cur.execute("UPDATE users SET failed_attempts=0, locked_until=NOW() + INTERVAL '5 minutes' WHERE id=%s", (found['id'],))
                    conn.commit()
                    return _resp(423, {'error': 'Слишком много попыток. Аккаунт заблокирован на 5 минут.'})
                cur.execute("UPDATE users SET failed_attempts=%s WHERE id=%s", (attempts, found['id']))
                conn.commit()
                return _resp(401, {'error': f'Неверный пароль. Осталось попыток: {3 - attempts}'})
            # Освобождаем device_id от других аккаунтов — иначе конфликт уникального индекса
            if device_id:
                cur.execute("UPDATE users SET device_id=NULL WHERE device_id=%s AND id!=%s", (device_id, found['id']))
            cur.execute(
                "UPDATE users SET failed_attempts=0, locked_until=NULL, device_id=%s, is_online=TRUE, last_seen=NOW() WHERE id=%s",
                (device_id or None, found['id']),
            )
            conn.commit()
            result = {'id': found['id'], 'nick': found['nick'], 'first_name': found['first_name'], 'last_name': found['last_name'],
                       'profile_complete': found['profile_complete'], 'avatar_url': found['avatar_url'], 'is_verified': found['is_verified']}
            return _resp(200, {'user': result})

        # ── FORGOT PASSWORD: отправка 4-значного кода на почту ──────────────
        if action == 'forgot_password' and method == 'POST':
            email = (body.get('email') or '').strip().lower()
            if not EMAIL_RE.match(email):
                return _resp(400, {'error': 'Введи корректную почту'})
            cur.execute("SELECT id FROM users WHERE email=%s", (email,))
            found = cur.fetchone()
            if not found:
                return _resp(404, {'error': 'Аккаунт с такой почтой не найден'})
            code = f'{random.randint(0, 9999):04d}'
            cur.execute(
                "UPDATE users SET reset_code=%s, reset_code_expires=NOW() + INTERVAL '2 minutes' WHERE id=%s",
                (code, found['id']),
            )
            conn.commit()
            sent = _send_reset_code(email, code)
            if not sent:
                return _resp(500, {'error': 'Не удалось отправить код. Попробуй позже.'})
            return _resp(200, {'ok': True})

        # ── RESET PASSWORD: проверка кода + установка нового пароля ─────────
        if action == 'reset_password' and method == 'POST':
            email = (body.get('email') or '').strip().lower()
            code = (body.get('code') or '').strip()
            new_password = (body.get('new_password') or '').strip()
            if not EMAIL_RE.match(email):
                return _resp(400, {'error': 'Введи корректную почту'})
            if len(new_password) < 6:
                return _resp(400, {'error': 'Пароль минимум 6 символов'})
            cur.execute("SELECT id, reset_code, reset_code_expires FROM users WHERE email=%s", (email,))
            found = cur.fetchone()
            if not found or not found['reset_code'] or found['reset_code'] != code:
                return _resp(400, {'error': 'Неверный код'})
            if not found['reset_code_expires'] or found['reset_code_expires'] < datetime.now():
                return _resp(400, {'error': 'Код истёк. Запроси новый.'})
            cur.execute(
                "UPDATE users SET password_hash=%s, reset_code=NULL, reset_code_expires=NULL, failed_attempts=0, locked_until=NULL WHERE id=%s",
                (_hash_pw(new_password), found['id']),
            )
            conn.commit()
            return _resp(200, {'ok': True})

        # ── CHECK NICK ─────────────────────────────────────
        if action == 'check_nick' and method == 'GET':
            nick = (params.get('nick') or '').strip().lower()
            me = int(params.get('user_id') or 0)
            if not nick or len(nick) < 2:
                return _resp(200, {'available': False, 'error': 'Минимум 2 символа'})
            if len(nick) > 30:
                return _resp(200, {'available': False, 'error': 'Максимум 30 символов'})
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
            if not re.match(r'^[a-z0-9_]+$', new_nick):
                return _resp(400, {'error': 'Только латиница, цифры и _'})
            cur.execute("SELECT id FROM users WHERE nick = %s AND id != %s", (new_nick, uid))
            if cur.fetchone():
                return _resp(409, {'error': 'Этот ник уже занят'})
            cur.execute(
                "UPDATE users SET nick=%s, nick_changed_at=NOW() WHERE id=%s RETURNING id, nick, avatar_url, profile_complete, is_verified",
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
                SELECT u.id, u.nick, u.first_name, u.last_name, u.phone, u.avatar_url, u.city, u.birthdate, u.about, u.is_online, u.last_seen, u.is_verified,
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
            for f in ('avatar_url', 'city', 'birthdate', 'about', 'first_name', 'last_name'):
                if f in body:
                    fields[f] = body[f] or None
            if not fields:
                return _resp(400, {'error': 'Нет данных'})
            fields['profile_complete'] = True
            set_clause = ', '.join(f"{k} = %s" for k in fields)
            cur.execute(
                f"UPDATE users SET {set_clause} WHERE id = %s RETURNING id, nick, first_name, last_name, avatar_url, city, birthdate, about, profile_complete",
                list(fields.values()) + [uid],
            )
            user = cur.fetchone()
            conn.commit()
            return _resp(200, {'user': user})

        # ── UPLOAD AVATAR ─────────────────────────────────
        if action == 'upload_avatar' and method == 'POST':
            uid = int(body.get('user_id') or 0)
            data_b64 = body.get('data', '')
            ext = (body.get('ext') or 'jpg').lower()
            raw = base64.b64decode(data_b64)
            key = f"avatars/{uid}_{secrets.token_hex(8)}.{ext}"
            s3 = _s3()
            s3.put_object(Bucket=REGRU_BUCKET, Key=key, Body=raw, ContentType=f'image/{ext}')
            url = _s3_url(key)
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
                SELECT u.id, u.nick, u.avatar_url, u.city, u.is_online, u.is_verified
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
                "SELECT u.id, u.nick, u.avatar_url, u.is_online, u.is_verified FROM users u JOIN follows f ON f.follower_id=u.id WHERE f.following_id=%s",
                (uid,),
            )
            return _resp(200, {'users': cur.fetchall()})

        if action == 'following' and method == 'GET':
            uid = int(params.get('user_id') or 0)
            cur.execute(
                "SELECT u.id, u.nick, u.avatar_url, u.is_online, u.is_verified FROM users u JOIN follows f ON f.following_id=u.id WHERE f.follower_id=%s",
                (uid,),
            )
            return _resp(200, {'users': cur.fetchall()})

        # ── CHATS LIST ────────────────────────────────────
        if action == 'chats' and method == 'GET':
            me = int(params.get('user_id') or 0)
            cur.execute(
                """
                SELECT * FROM (
                SELECT c.id AS chat_id,
                       NULL::int AS group_id, NULL AS group_name, NULL AS group_avatar,
                       u.id AS peer_id, u.nick AS peer_nick, u.avatar_url AS peer_avatar, u.is_online AS peer_online, u.is_verified AS peer_verified,
                       (SELECT text FROM messages m WHERE m.chat_id=c.id AND m.is_removed=FALSE ORDER BY m.id DESC LIMIT 1) AS last_text,
                       (SELECT created_at FROM messages m WHERE m.chat_id=c.id AND m.is_removed=FALSE ORDER BY m.id DESC LIMIT 1) AS last_at,
                       'dm' AS kind,
                       (SELECT COUNT(*) FROM messages m WHERE m.chat_id=c.id AND m.is_removed=FALSE AND m.sender_id != %s AND m.id > COALESCE((SELECT last_read_id FROM chat_reads WHERE chat_id=c.id AND user_id=%s), 0)) AS unread_count,
                       EXISTS(SELECT 1 FROM chat_pins cp WHERE cp.user_id=%s AND cp.chat_id=c.id) AS pinned
                FROM chats c
                JOIN users u ON u.id = CASE WHEN c.user_a=%s THEN c.user_b ELSE c.user_a END
                WHERE (c.user_a=%s OR c.user_b=%s) AND c.group_id IS NULL
                  AND EXISTS (
                    SELECT 1 FROM messages m WHERE m.chat_id=c.id AND m.is_removed=FALSE
                    AND m.created_at > COALESCE(
                      (SELECT hidden_at FROM hidden_chats WHERE user_id=%s AND chat_id=c.id),
                      '1970-01-01'::timestamptz
                    )
                  )
                UNION ALL
                SELECT c.id AS chat_id,
                       g.id AS group_id, g.name AS group_name, COALESCE(g.photo_url, g.avatar_url) AS group_avatar,
                       NULL, NULL, NULL, NULL, NULL,
                       (SELECT text FROM messages m WHERE m.chat_id=c.id AND m.is_removed=FALSE ORDER BY m.id DESC LIMIT 1) AS last_text,
                       (SELECT created_at FROM messages m WHERE m.chat_id=c.id AND m.is_removed=FALSE ORDER BY m.id DESC LIMIT 1) AS last_at,
                       'group' AS kind,
                       (SELECT COUNT(*) FROM messages m WHERE m.chat_id=c.id AND m.is_removed=FALSE AND m.sender_id != %s AND m.id > COALESCE((SELECT last_read_id FROM chat_reads WHERE chat_id=c.id AND user_id=%s), 0)) AS unread_count,
                       EXISTS(SELECT 1 FROM chat_pins cp WHERE cp.user_id=%s AND cp.chat_id=c.id) AS pinned
                FROM chats c
                JOIN groups g ON g.id=c.group_id
                JOIN group_members gm ON gm.group_id=g.id AND gm.user_id=%s
                WHERE c.id NOT IN (SELECT chat_id FROM hidden_chats WHERE user_id=%s)
                ) t
                ORDER BY pinned DESC, last_at DESC NULLS FIRST, chat_id DESC
                """,
                (me, me, me, me, me, me, me, me, me, me, me, me),
            )
            return _resp(200, {'chats': cur.fetchall()})

        # ── PIN / UNPIN CHAT ──────────────────────────────
        if action == 'pin_chat' and method == 'POST':
            uid = int(body.get('user_id') or 0)
            chat_id = int(body.get('chat_id') or 0)
            cur.execute("SELECT 1 FROM chat_pins WHERE user_id=%s AND chat_id=%s", (uid, chat_id))
            if cur.fetchone():
                cur.execute("DELETE FROM chat_pins WHERE user_id=%s AND chat_id=%s", (uid, chat_id))
                pinned = False
            else:
                cur.execute("INSERT INTO chat_pins (user_id, chat_id) VALUES (%s, %s)", (uid, chat_id))
                pinned = True
            conn.commit()
            return _resp(200, {'pinned': pinned})

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
            # НЕ удаляем hidden_chats — hidden_at остаётся как граница очистки переписки
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
        # ── CHAT POLL (messages + read_status + chat_status в одном запросе) ─
        if action == 'chat_poll' and method == 'GET':
            chat_id = int(params.get('chat_id') or 0)
            after   = int(params.get('after') or 0)
            me      = int(params.get('user_id') or 0)
            peer_id = int(params.get('peer_id') or 0)

            def _fetch_poll():
                cur.execute(
                    """
                    SELECT m.id, m.sender_id, u.nick AS sender_nick, u.avatar_url AS sender_avatar, u.is_verified AS sender_verified,
                           m.text, m.image_url, m.media_type, m.media_url, m.created_at,
                           m.is_removed, m.removed_by_sender, m.is_read, m.reply_to_id,
                           rm.text AS reply_to_text, ru.nick AS reply_to_nick,
                           COALESCE(
                               json_agg(json_build_object('emoji', r.emoji, 'user_id', r.user_id))
                               FILTER (WHERE r.message_id IS NOT NULL), '[]'
                           ) AS reactions
                    FROM messages m
                    JOIN users u ON u.id = m.sender_id
                    LEFT JOIN message_reactions r ON r.message_id = m.id
                    LEFT JOIN messages rm ON rm.id = m.reply_to_id
                    LEFT JOIN users ru ON ru.id = rm.sender_id
                    WHERE m.chat_id=%s AND m.id>%s
                      AND NOT (m.removed_by_sender = TRUE AND m.sender_id = %s)
                      AND m.created_at > COALESCE(
                        (SELECT hidden_at FROM hidden_chats WHERE user_id=%s AND chat_id=%s),
                        '1970-01-01'::timestamptz
                      )
                    GROUP BY m.id, u.nick, u.avatar_url, u.is_verified, rm.text, ru.nick
                    ORDER BY m.id ASC LIMIT 200
                    """,
                    (chat_id, after, me, me, chat_id),
                )
                return cur.fetchall()

            # Long polling: ждём до 2 сек если нет новых сообщений (экономия вычислительного времени)
            import time as _time
            msgs = _fetch_poll()
            if not msgs:
                deadline = _time.time() + 2.0
                while _time.time() < deadline:
                    _time.sleep(0.7)
                    msgs = _fetch_poll()
                    if msgs:
                        break

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
            cur.execute(
                "SELECT MAX(id) AS read_until FROM messages WHERE chat_id=%s AND sender_id=%s AND is_read=TRUE",
                (chat_id, me),
            )
            ru_row = cur.fetchone()
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
            peer_online = False
            peer_last_seen = None
            if peer_id:
                cur.execute("SELECT is_online, last_seen FROM users WHERE id=%s", (peer_id,))
                pr = cur.fetchone()
                if pr:
                    peer_online = bool(pr['is_online'])
                    peer_last_seen = pr['last_seen'].isoformat() if pr['last_seen'] else None
            cur.execute(
                """
                SELECT m.id, m.is_removed,
                       COALESCE(
                           json_agg(json_build_object('emoji', r.emoji, 'user_id', r.user_id))
                           FILTER (WHERE r.message_id IS NOT NULL), '[]'
                       ) AS reactions
                FROM messages m
                LEFT JOIN message_reactions r ON r.message_id = m.id
                WHERE m.chat_id=%s
                  AND (
                    m.is_removed = TRUE
                    OR EXISTS (
                      SELECT 1 FROM message_reactions mr
                      WHERE mr.message_id = m.id
                        AND mr.created_at > NOW() - INTERVAL '30 seconds'
                    )
                  )
                GROUP BY m.id
                """,
                (chat_id,),
            )
            updates = cur.fetchall()
            conn.commit()
            return _resp(200, {
                'messages':      msgs,
                'read_until':    ru_row['read_until'] if ru_row else None,
                'typing':        typing,
                'peer_online':   peer_online,
                'peer_last_seen': peer_last_seen,
                'updates':       updates,
            })

        if action == 'messages' and method == 'GET':
            chat_id = int(params.get('chat_id') or 0)
            after = int(params.get('after') or 0)
            me = int(params.get('user_id') or 0)
            cur.execute(
                """
                SELECT m.id, m.sender_id, u.nick AS sender_nick, u.avatar_url AS sender_avatar, u.is_verified AS sender_verified,
                       m.text, m.image_url, m.media_type, m.media_url, m.created_at,
                       m.is_removed, m.removed_by_sender, m.is_read, m.reply_to_id,
                       rm.text AS reply_to_text, ru.nick AS reply_to_nick,
                       COALESCE(
                           json_agg(json_build_object('emoji', r.emoji, 'user_id', r.user_id))
                           FILTER (WHERE r.message_id IS NOT NULL), '[]'
                       ) AS reactions
                FROM messages m
                JOIN users u ON u.id = m.sender_id
                LEFT JOIN message_reactions r ON r.message_id = m.id
                LEFT JOIN messages rm ON rm.id = m.reply_to_id
                LEFT JOIN users ru ON ru.id = rm.sender_id
                WHERE m.chat_id=%s AND m.id>%s
                  AND NOT (m.removed_by_sender = TRUE AND m.sender_id = %s)
                GROUP BY m.id, u.nick, u.avatar_url, u.is_verified, rm.text, ru.nick
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
            reply_to_id = body.get('reply_to_id')
            if not chat_id or not sender or (not text and not image_url and not media_url):
                return _resp(400, {'error': 'Пустое сообщение'})
            # Приватность: может ли sender писать получателю (только для личных чатов)
            cur.execute("SELECT user_a, user_b, group_id FROM chats WHERE id=%s", (chat_id,))
            chat_check = cur.fetchone()
            if chat_check and not chat_check['group_id']:
                other_id = chat_check['user_b'] if chat_check['user_a'] == sender else chat_check['user_a']
                if not _privacy_allows(other_id, sender, 'privacy_messages'):
                    return _resp(403, {'error': 'Этот пользователь ограничил круг тех, кто может ему писать'})
            cur.execute(
                """INSERT INTO messages (chat_id, sender_id, text, image_url, media_type, media_url, reply_to_id)
                   VALUES (%s, %s, %s, %s, %s, %s, %s)
                   RETURNING id, sender_id, text, image_url, media_type, media_url, created_at, is_removed, reply_to_id""",
                (chat_id, sender, text, image_url, media_type, media_url, int(reply_to_id) if reply_to_id else None),
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

        # ── PRESIGNED URL (не используется, оставлен для совместимости) ────────
        if action == 'get_upload_url' and method == 'POST':
            return _resp(400, {'error': 'Используй upload_chunk'})

        # ── UPLOAD CHUNK (загрузка кусочка файла — raw binary) ─────────
        if action == 'upload_chunk' and method == 'POST':
            """Принимает кусочек файла как raw binary и сохраняет в S3"""
            uid       = int(params.get('user_id') or 0)
            upload_id = params.get('upload_id', '')
            chunk_idx = int(params.get('chunk_index') or 0)
            raw_b = event.get('body') or ''
            if not upload_id or not raw_b:
                return _resp(400, {'error': 'Нет данных'})
            # Тело приходит как base64 (платформа всегда кодирует binary)
            if event.get('isBase64Encoded'):
                raw = base64.b64decode(raw_b)
            else:
                raw = raw_b.encode('latin-1') if isinstance(raw_b, str) else raw_b
            key = f"chunks/{uid}/{upload_id}/{chunk_idx:05d}"
            s3 = _s3()
            s3.put_object(Bucket=REGRU_BUCKET, Key=key, Body=raw)
            print(f'[CHUNK] uid={uid} upload_id={upload_id} chunk={chunk_idx} size={len(raw)}')
            return _resp(200, {'ok': True})

        # ── ASSEMBLE CHUNKS (склеить кусочки через S3 multipart) ──────
        if action == 'assemble_chunks' and method == 'POST':
            """Склеивает все кусочки в один файл через S3 multipart upload"""
            uid         = int(body.get('user_id') or 0)
            upload_id   = body.get('upload_id', '')
            total       = int(body.get('total_chunks') or 0)
            ext         = (body.get('ext') or 'mp4').lower()
            media_type  = body.get('media_type', 'video')
            if not upload_id or not total:
                return _resp(400, {'error': 'Нет данных'})
            ct_map = {'video': f'video/{ext}', 'audio': f'audio/{ext}', 'voice': 'audio/ogg', 'file': 'application/octet-stream'}
            content_type = ct_map.get(media_type, 'application/octet-stream')
            s3 = _s3()
            final_key = f"media/{uid}/{upload_id}.{ext}"
            mpu = s3.create_multipart_upload(Bucket=REGRU_BUCKET, Key=final_key, ContentType=content_type)
            mp_id = mpu['UploadId']
            parts = []
            buf = b''
            MIN_PART = 6 * 1024 * 1024  # 6 МБ — минимальный размер multipart части
            part_num = 1
            try:
                for i in range(total):
                    chunk_key = f"chunks/{uid}/{upload_id}/{i:05d}"
                    obj = s3.get_object(Bucket=REGRU_BUCKET, Key=chunk_key)
                    buf += obj['Body'].read()
                    if len(buf) >= MIN_PART or i == total - 1:
                        resp = s3.upload_part(Bucket=REGRU_BUCKET, Key=final_key, UploadId=mp_id, PartNumber=part_num, Body=buf)
                        parts.append({'PartNumber': part_num, 'ETag': resp['ETag']})
                        part_num += 1
                        buf = b''
                s3.complete_multipart_upload(Bucket=REGRU_BUCKET, Key=final_key, UploadId=mp_id, MultipartUpload={'Parts': parts})
                # Удаляем чанки после успешной сборки
                for i in range(total):
                    try: s3.delete_object(Bucket=REGRU_BUCKET, Key=f"chunks/{uid}/{upload_id}/{i:05d}")
                    except: pass
            except Exception as e:
                s3.abort_multipart_upload(Bucket=REGRU_BUCKET, Key=final_key, UploadId=mp_id)
                print(f'[ASSEMBLE] error: {e}')
                return _resp(500, {'error': f'Ошибка сборки: {e}'})
            url = _s3_url(final_key)
            print(f'[ASSEMBLE] OK uid={uid} upload_id={upload_id} total={total} parts={part_num-1} url={url}')
            return _resp(200, {'url': url, 'media_type': media_type})

        # ── UPLOAD MEDIA ──────────────────────────────────
        if action == 'upload_media' and method == 'POST':
            uid = int(body.get('user_id') or 0)
            data_b64 = body.get('data', '')
            ext = (body.get('ext') or 'jpg').lower()
            media_type = body.get('media_type', 'image')
            print(f'[MEDIA] uid={uid} media_type={media_type} ext={ext} data_len={len(data_b64)}')
            if not data_b64:
                return _resp(400, {'error': 'Нет данных'})
            try:
                raw = base64.b64decode(data_b64)
            except Exception as e:
                print(f'[MEDIA] base64 error: {e}')
                return _resp(400, {'error': 'Ошибка декодирования'})
            key = f"media/{uid}/{int(time.time())}.{ext}"
            ct_map = {'image': f'image/{ext}', 'video': f'video/{ext}', 'audio': f'audio/{ext}', 'voice': 'audio/ogg', 'file': 'application/octet-stream'}
            content_type = ct_map.get(media_type, 'application/octet-stream')
            s3 = _s3()
            s3.put_object(Bucket=REGRU_BUCKET, Key=key, Body=raw, ContentType=content_type)
            url = _s3_url(key)
            print(f'[MEDIA] OK url={url}')
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

        # ── КТО ПРОЧИТАЛ СООБЩЕНИЕ ───────────────────────
        if action == 'msg_read_by' and method == 'GET':
            msg_id = int(params.get('message_id') or 0)
            chat_id_p = int(params.get('chat_id') or 0)
            uid = int(params.get('user_id') or 0)
            # Участники группы которые прочитали до этого сообщения (не считая отправителя)
            cur.execute("""
                SELECT u.id, u.nick, u.avatar_url
                FROM t_p93658230_mini_messenger_proje.chat_reads cr
                JOIN t_p93658230_mini_messenger_proje.users u ON u.id = cr.user_id
                WHERE cr.chat_id = %s AND cr.last_read_id >= %s AND cr.user_id != %s
            """, (chat_id_p, msg_id, uid))
            readers = cur.fetchall()
            return _resp(200, {'readers': readers})

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

        # ── HIDE CHAT (скрыть + запомнить время удаления) ──
        if action == 'hide_chat' and method == 'POST':
            uid = int(body.get('user_id') or 0)
            chat_id = int(body.get('chat_id') or 0)
            # Скрываем чат с текущим временем — hidden_at используется как граница очистки
            cur.execute(
                "INSERT INTO hidden_chats (user_id, chat_id, hidden_at) VALUES (%s, %s, NOW()) ON CONFLICT (user_id, chat_id) DO UPDATE SET hidden_at=NOW()",
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
            uid       = int(body.get('user_id') or 0)
            after_sig = int(body.get('after_sig') or 0)
            after_not = int(body.get('after_not') or 0)
            cur.execute("SELECT id FROM users WHERE id=%s", (uid,))
            if not cur.fetchone():
                return _resp(200, {'deleted': True})
            cur.execute("UPDATE users SET is_online=TRUE, last_seen=NOW() WHERE id=%s", (uid,))
            # Входящий звонок
            cur.execute(
                "SELECT ac.call_id, ac.caller_id, ac.kind, u.nick, u.avatar_url FROM active_calls ac JOIN users u ON u.id=ac.caller_id WHERE ac.callee_id=%s AND ac.status='ringing' ORDER BY ac.created_at DESC LIMIT 1",
                (uid,)
            )
            incoming = cur.fetchone()
            # Новые сигналы звонка
            cur.execute(
                "SELECT id, call_id, from_user_id, type, payload FROM call_signals WHERE to_user_id=%s AND id>%s ORDER BY id ASC LIMIT 10",
                (uid, after_sig)
            )
            signals = cur.fetchall()
            # Новые уведомления
            cur.execute(
                "SELECT n.id, n.type, u.nick AS from_nick FROM notifications n LEFT JOIN users u ON u.id=n.from_user_id WHERE n.user_id=%s AND n.id>%s AND n.is_read=FALSE ORDER BY n.id DESC LIMIT 10",
                (uid, after_not)
            )
            notifs = cur.fetchall()
            conn.commit()
            return _resp(200, {'ok': True, 'incoming': incoming, 'signals': signals, 'notifs': notifs})

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
            cur.execute("DELETE FROM message_reactions WHERE user_id=%s", (uid,))
            cur.execute("DELETE FROM messages WHERE sender_id=%s", (uid,))
            cur.execute("DELETE FROM follows WHERE follower_id=%s OR following_id=%s", (uid, uid))
            cur.execute("DELETE FROM blocks WHERE blocker_id=%s OR blocked_id=%s", (uid, uid))
            cur.execute("DELETE FROM group_members WHERE user_id=%s", (uid,))
            cur.execute("DELETE FROM chat_pins WHERE user_id=%s", (uid,))
            cur.execute("DELETE FROM hidden_chats WHERE user_id=%s", (uid,))
            cur.execute("DELETE FROM post_comments WHERE user_id=%s", (uid,))
            cur.execute("DELETE FROM post_likes WHERE user_id=%s", (uid,))
            cur.execute("DELETE FROM post_views WHERE user_id=%s", (uid,))
            cur.execute("DELETE FROM posts WHERE user_id=%s", (uid,))
            cur.execute("DELETE FROM status_views WHERE viewer_id=%s OR status_id IN (SELECT id FROM statuses WHERE user_id=%s)", (uid, uid))
            cur.execute("DELETE FROM statuses WHERE user_id=%s", (uid,))
            cur.execute("DELETE FROM notifications WHERE user_id=%s OR from_user_id=%s", (uid, uid))
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
            after_ts = params.get('after_ts', '1970-01-01')  # показывать только после этой даты
            cur.execute(
                """
                SELECT n.id, n.type, n.from_user_id, n.chat_id, n.group_id,
                       n.payload, n.is_read, n.created_at,
                       u.nick AS from_nick, u.avatar_url AS from_avatar
                FROM notifications n
                LEFT JOIN users u ON u.id = n.from_user_id
                WHERE n.user_id = %s AND n.created_at > %s::timestamptz
                ORDER BY n.created_at DESC LIMIT 50
                """,
                (uid, after_ts),
            )
            notifs = cur.fetchall()
            cur.execute("SELECT COUNT(*) AS cnt FROM notifications WHERE user_id=%s AND is_read=FALSE AND created_at > %s::timestamptz", (uid, after_ts))
            unread = cur.fetchone()['cnt']
            return _resp(200, {'notifications': notifs, 'unread': unread})

        # ── NOTIFICATIONS CLEAR ────────────────────────────
        if action == 'clear_notifications' and method == 'POST':
            uid = int(body.get('user_id') or 0)
            cur.execute("UPDATE notifications SET is_read=TRUE WHERE user_id=%s", (uid,))
            conn.commit()
            return _resp(200, {'ok': True, 'cleared_at': 'now'})

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

        # ── CALL HISTORY ──────────────────────────────────
        if action == 'call_history' and method == 'GET':
            uid = int(params.get('user_id') or 0)
            after_ts = params.get('after_ts', '1970-01-01')
            cur.execute(
                """
                SELECT ac.call_id, ac.kind, ac.status, ac.created_at,
                       ac.caller_id, ac.callee_id,
                       u1.nick AS caller_nick, u1.avatar_url AS caller_avatar,
                       u2.nick AS callee_nick, u2.avatar_url AS callee_avatar
                FROM active_calls ac
                JOIN users u1 ON u1.id = ac.caller_id
                JOIN users u2 ON u2.id = ac.callee_id
                WHERE (ac.caller_id=%s OR ac.callee_id=%s)
                  AND ac.created_at > %s::timestamptz
                ORDER BY ac.created_at DESC LIMIT 50
                """,
                (uid, uid, after_ts),
            )
            calls = cur.fetchall()
            return _resp(200, {'calls': calls})

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
                SELECT u.id, u.nick, u.avatar_url, u.is_online, u.is_verified, gm.role
                FROM group_members gm JOIN users u ON u.id=gm.user_id
                WHERE gm.group_id=%s ORDER BY gm.role DESC, u.nick
                """,
                (gid,),
            )
            members = cur.fetchall()
            # Подписчики владельца, кого ещё нет в группе
            cur.execute(
                """
                SELECT u.id, u.nick, u.avatar_url, u.is_online, u.is_verified
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
            gid = int(body.get('group_id') or 0)
            uid = int(body.get('user_id') or 0)
            print(f'[GROUP_PHOTO] gid={gid} uid={uid}')
            cur.execute("SELECT role FROM group_members WHERE group_id=%s AND user_id=%s", (gid, uid))
            r = cur.fetchone()
            if not r or r['role'] not in ('admin', 'owner'):
                print(f'[GROUP_PHOTO] нет прав: role={r}')
                return _resp(403, {'error': 'Нет прав'})
            data_b64 = body.get('data', '')
            ext = (body.get('ext') or 'jpg').lower()
            print(f'[GROUP_PHOTO] data_len={len(data_b64)} ext={ext}')
            if not data_b64:
                return _resp(400, {'error': 'Нет данных фото'})
            try:
                raw = base64.b64decode(data_b64)
            except Exception as e:
                print(f'[GROUP_PHOTO] base64 error: {e}')
                return _resp(400, {'error': 'Ошибка декодирования'})
            key = f"groups/{gid}/photo.{ext}"
            try:
                s3 = _s3()
                s3.put_object(Bucket=REGRU_BUCKET, Key=key, Body=raw, ContentType=f'image/{ext}')
                print(f'[GROUP_PHOTO] S3 upload OK key={key}')
            except Exception as e:
                print(f'[GROUP_PHOTO] S3 error: {e}')
                return _resp(500, {'error': f'Ошибка загрузки: {e}'})
            url = _s3_url(key) + f"?t={int(time.time())}"
            cur.execute("UPDATE groups SET photo_url=%s WHERE id=%s", (url, gid))
            conn.commit()
            print(f'[GROUP_PHOTO] OK url={url}')
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
            if sig_type == 'offer' and not _privacy_allows(to_uid, from_uid, 'privacy_calls'):
                return _resp(403, {'error': 'Этот пользователь ограничил круг тех, кто может ему звонить'})
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
                # Push-уведомление о входящем звонке
                cur.execute("SELECT nick FROM users WHERE id=%s", (from_uid,))
                caller = cur.fetchone()
                caller_nick = caller['nick'] if caller else 'Кто-то'
                kind_label = '📹 Видеозвонок' if kind == 'video' else '📞 Голосовой звонок'
                conn.commit()
                _push(
                    [to_uid],
                    f'{kind_label} от @{caller_nick}',
                    'Нажмите чтобы ответить',
                    '/',
                )
                return _resp(200, {'ok': True})
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

        # ── TEST PUSH (только для отладки) ────────────────
        if action == 'test_push' and method == 'POST':
            uid = int(body.get('user_id') or 0)
            if not uid:
                return _resp(400, {'error': 'user_id обязателен'})
            result = _push([uid], '🔔 Вай Мессенджер', 'Push-уведомления работают!', '/')
            return _resp(200, {'result': result})

        # ══════════════════════════════════════════════════
        # ЛЕНТА ПУБЛИКАЦИЙ (посты: фото / видео / текст)
        # ══════════════════════════════════════════════════

        def _can_view_post(owner_id: int, viewer_id: int) -> bool:
            """Проверка приватности: может ли viewer видеть посты owner."""
            if owner_id == viewer_id:
                return True
            cur.execute("SELECT privacy_content FROM users WHERE id=%s", (owner_id,))
            row = cur.fetchone()
            mode = row['privacy_content'] if row else 'all'
            if mode == 'all':
                return True
            cur.execute("SELECT 1 FROM follows WHERE follower_id=%s AND following_id=%s", (viewer_id, owner_id))
            is_follower = cur.fetchone() is not None
            if mode == 'followers':
                return is_follower
            if mode == 'selected':
                cur.execute("SELECT 1 FROM profile_content_allowed WHERE owner_id=%s AND viewer_id=%s", (owner_id, viewer_id))
                return cur.fetchone() is not None
            return True

        # ── Создать публикацию ────────────────────────────
        if action == 'post_create' and method == 'POST':
            uid = int(body.get('user_id') or 0)
            p_type = body.get('type', 'text')
            content = (body.get('content') or '').strip()
            caption = (body.get('caption') or '').strip() or None
            media_urls = body.get('media_urls') or None
            if not uid or p_type not in ('photo', 'video', 'text') or not content:
                return _resp(400, {'error': 'Некорректные данные публикации'})
            if p_type == 'text' and len(content) > 2000:
                return _resp(400, {'error': 'Текст максимум 2000 символов'})
            cur.execute(
                """INSERT INTO posts (user_id, type, content, caption, media_urls, created_at)
                   VALUES (%s, %s, %s, %s, %s, NOW())
                   RETURNING id, user_id, type, content, caption, media_urls, created_at""",
                (uid, p_type, content, caption, media_urls),
            )
            post = cur.fetchone()
            conn.commit()
            cur.execute("SELECT nick, avatar_url, is_verified FROM users WHERE id=%s", (uid,))
            author = cur.fetchone()
            post['nick'] = author['nick']
            post['avatar_url'] = author['avatar_url']
            post['is_verified'] = author['is_verified']
            post['likes_count'] = 0
            post['comments_count'] = 0
            post['views_count'] = 0
            post['liked_by_me'] = False
            return _resp(200, {'post': post})

        # ── Редактировать публикацию ──────────────────────
        if action == 'post_edit' and method == 'POST':
            uid = int(body.get('user_id') or 0)
            pid = int(body.get('post_id') or 0)
            caption = body.get('caption')
            text_content = body.get('content')
            cur.execute("SELECT user_id, type FROM posts WHERE id=%s", (pid,))
            row = cur.fetchone()
            if not row or row['user_id'] != uid:
                return _resp(404, {'error': 'Публикация не найдена'})
            if row['type'] == 'text' and text_content is not None:
                text_content = text_content.strip()
                if not text_content:
                    return _resp(400, {'error': 'Текст не может быть пустым'})
                cur.execute("UPDATE posts SET content=%s WHERE id=%s", (text_content, pid))
            elif caption is not None:
                cur.execute("UPDATE posts SET caption=%s WHERE id=%s", ((caption or '').strip() or None, pid))
            conn.commit()
            return _resp(200, {'ok': True})

        # ── Загрузка медиа для публикации (фото/видео) ────
        if action == 'upload_post_media' and method == 'POST':
            uid = int(body.get('user_id') or 0)
            data_b64 = body.get('data', '')
            ext = (body.get('ext') or 'jpg').lower()
            media_type = body.get('media_type', 'photo')
            if not uid or not data_b64:
                return _resp(400, {'error': 'Нет данных'})
            raw = base64.b64decode(data_b64)
            key = f"posts/{uid}/{secrets.token_hex(8)}.{ext}"
            s3 = _s3()
            content_type = 'video/mp4' if media_type == 'video' else 'image/jpeg'
            s3.put_object(Bucket=REGRU_BUCKET, Key=key, Body=raw, ContentType=content_type)
            return _resp(200, {'url': _s3_url(key)})

        # ── Лента: посты свои + тех, на кого подписан ─────
        if action == 'feed' and method == 'GET':
            me = int(params.get('user_id') or 0)
            after = int(params.get('after') or 0)
            cur.execute(
                """
                SELECT p.id, p.user_id, u.nick, u.avatar_url, u.is_verified,
                       p.type, p.content, p.caption, p.media_urls, p.created_at,
                       (SELECT COUNT(*) FROM post_likes pl WHERE pl.post_id=p.id) AS likes_count,
                       (SELECT COUNT(*) FROM post_comments pc WHERE pc.post_id=p.id) AS comments_count,
                       (SELECT COUNT(*) FROM post_views pv WHERE pv.post_id=p.id) AS views_count,
                       EXISTS(SELECT 1 FROM post_likes pl2 WHERE pl2.post_id=p.id AND pl2.user_id=%s) AS liked_by_me
                FROM posts p
                JOIN users u ON u.id = p.user_id
                WHERE p.is_removed = FALSE
                  AND (p.user_id = %s OR p.user_id IN (SELECT following_id FROM follows WHERE follower_id=%s))
                  AND (%s = 0 OR p.id < %s)
                ORDER BY p.id DESC
                LIMIT 20
                """,
                (me, me, me, after, after),
            )
            posts = cur.fetchall()
            return _resp(200, {'posts': posts})

        # ── Поиск публикаций по нику автора ───────────────
        if action == 'post_search' and method == 'GET':
            me = int(params.get('user_id') or 0)
            q = (params.get('q') or '').strip().lower()
            if not q:
                return _resp(200, {'posts': []})
            cur.execute(
                """
                SELECT p.id, p.user_id, u.nick, u.avatar_url, u.is_verified,
                       p.type, p.content, p.caption, p.media_urls, p.created_at, u.privacy_content,
                       (SELECT COUNT(*) FROM post_likes pl WHERE pl.post_id=p.id) AS likes_count,
                       (SELECT COUNT(*) FROM post_comments pc WHERE pc.post_id=p.id) AS comments_count,
                       (SELECT COUNT(*) FROM post_views pv WHERE pv.post_id=p.id) AS views_count,
                       EXISTS(SELECT 1 FROM post_likes pl2 WHERE pl2.post_id=p.id AND pl2.user_id=%s) AS liked_by_me
                FROM posts p
                JOIN users u ON u.id = p.user_id
                WHERE p.is_removed = FALSE AND u.nick ILIKE %s
                ORDER BY p.id DESC LIMIT 40
                """,
                (me, f'%{q}%'),
            )
            rows = cur.fetchall()
            posts = [r for r in rows if _can_view_post(r['user_id'], me)]
            for r in posts:
                r.pop('privacy_content', None)
            return _resp(200, {'posts': posts})

        # ── Посты конкретного пользователя (для профиля) ──
        if action == 'user_posts' and method == 'GET':
            me = int(params.get('user_id') or 0)
            owner = int(params.get('owner_id') or 0)
            if not _can_view_post(owner, me):
                return _resp(200, {'posts': [], 'restricted': True})
            cur.execute(
                """
                SELECT p.id, p.user_id, u.nick, u.avatar_url, u.is_verified,
                       p.type, p.content, p.caption, p.media_urls, p.created_at,
                       (SELECT COUNT(*) FROM post_likes pl WHERE pl.post_id=p.id) AS likes_count,
                       (SELECT COUNT(*) FROM post_comments pc WHERE pc.post_id=p.id) AS comments_count,
                       (SELECT COUNT(*) FROM post_views pv WHERE pv.post_id=p.id) AS views_count,
                       EXISTS(SELECT 1 FROM post_likes pl2 WHERE pl2.post_id=p.id AND pl2.user_id=%s) AS liked_by_me
                FROM posts p
                JOIN users u ON u.id = p.user_id
                WHERE p.is_removed = FALSE AND p.user_id = %s
                ORDER BY p.id DESC
                """,
                (me, owner),
            )
            posts = cur.fetchall()
            return _resp(200, {'posts': posts, 'restricted': False})

        # ── Лайк / дизлайк ─────────────────────────────────
        if action == 'post_like' and method == 'POST':
            uid = int(body.get('user_id') or 0)
            pid = int(body.get('post_id') or 0)
            cur.execute("SELECT 1 FROM post_likes WHERE post_id=%s AND user_id=%s", (pid, uid))
            already = cur.fetchone() is not None
            if already:
                cur.execute("DELETE FROM post_likes WHERE post_id=%s AND user_id=%s", (pid, uid))
                liked = False
                cur.execute("DELETE FROM notifications WHERE post_id=%s AND from_user_id=%s AND type='post_like'", (pid, uid))
            else:
                cur.execute("INSERT INTO post_likes (post_id, user_id, created_at) VALUES (%s,%s,NOW()) ON CONFLICT DO NOTHING", (pid, uid))
                liked = True
                cur.execute("SELECT user_id FROM posts WHERE id=%s", (pid,))
                owner = cur.fetchone()
                if owner and owner['user_id'] != uid:
                    cur.execute(
                        "INSERT INTO notifications (user_id, type, from_user_id, post_id, created_at, is_read) VALUES (%s,'post_like',%s,%s,NOW(),FALSE)",
                        (owner['user_id'], uid, pid),
                    )
            conn.commit()
            cur.execute("SELECT COUNT(*) AS c FROM post_likes WHERE post_id=%s", (pid,))
            cnt = cur.fetchone()['c']
            return _resp(200, {'liked': liked, 'likes_count': cnt})

        # ── Комментарии: добавить (с поддержкой отметки/ответа человеку) ──
        if action == 'post_comment_add' and method == 'POST':
            uid = int(body.get('user_id') or 0)
            pid = int(body.get('post_id') or 0)
            text = (body.get('text') or '').strip()
            reply_to = body.get('reply_to_user_id')
            reply_to = int(reply_to) if reply_to else None
            if not text:
                return _resp(400, {'error': 'Пустой комментарий'})
            cur.execute(
                """INSERT INTO post_comments (post_id, user_id, text, reply_to_user_id, created_at)
                   VALUES (%s,%s,%s,%s,NOW())
                   RETURNING id, post_id, user_id, text, reply_to_user_id, created_at, is_edited""",
                (pid, uid, text, reply_to),
            )
            comment = cur.fetchone()
            cur.execute("SELECT nick, avatar_url, is_verified FROM users WHERE id=%s", (uid,))
            author = cur.fetchone()
            comment['nick'] = author['nick']
            comment['avatar_url'] = author['avatar_url']
            comment['is_verified'] = author['is_verified']
            comment['reply_to_nick'] = None
            if reply_to:
                cur.execute("SELECT nick FROM users WHERE id=%s", (reply_to,))
                rr = cur.fetchone()
                comment['reply_to_nick'] = rr['nick'] if rr else None
            cur.execute("SELECT user_id FROM posts WHERE id=%s", (pid,))
            owner = cur.fetchone()
            notified = set()
            if owner and owner['user_id'] != uid:
                cur.execute(
                    "INSERT INTO notifications (user_id, type, from_user_id, post_id, created_at, is_read) VALUES (%s,'post_comment',%s,%s,NOW(),FALSE)",
                    (owner['user_id'], uid, pid),
                )
                notified.add(owner['user_id'])
            if reply_to and reply_to != uid and reply_to not in notified:
                cur.execute(
                    "INSERT INTO notifications (user_id, type, from_user_id, post_id, created_at, is_read) VALUES (%s,'post_mention',%s,%s,NOW(),FALSE)",
                    (reply_to, uid, pid),
                )
            conn.commit()
            return _resp(200, {'comment': comment})

        # ── Комментарии: редактировать (только свои) ──────
        if action == 'post_comment_edit' and method == 'POST':
            uid = int(body.get('user_id') or 0)
            cid = int(body.get('comment_id') or 0)
            text = (body.get('text') or '').strip()
            if not text:
                return _resp(400, {'error': 'Пустой комментарий'})
            cur.execute("UPDATE post_comments SET text=%s, is_edited=TRUE WHERE id=%s AND user_id=%s", (text, cid, uid))
            conn.commit()
            return _resp(200, {'ok': True})

        # ── Комментарии: удалить (только свои) ────────────
        if action == 'post_comment_delete' and method == 'POST':
            uid = int(body.get('user_id') or 0)
            cid = int(body.get('comment_id') or 0)
            cur.execute("DELETE FROM post_comments WHERE id=%s AND user_id=%s", (cid, uid))
            conn.commit()
            return _resp(200, {'ok': True})

        # ── Комментарии: список ────────────────────────────
        if action == 'post_comments' and method == 'GET':
            pid = int(params.get('post_id') or 0)
            cur.execute(
                """SELECT c.id, c.post_id, c.user_id, u.nick, u.avatar_url, u.is_verified,
                          c.text, c.reply_to_user_id, ru.nick AS reply_to_nick, c.created_at, c.is_edited
                   FROM post_comments c
                   JOIN users u ON u.id=c.user_id
                   LEFT JOIN users ru ON ru.id=c.reply_to_user_id
                   WHERE c.post_id=%s ORDER BY c.id ASC""",
                (pid,),
            )
            return _resp(200, {'comments': cur.fetchall()})

        # ── Просмотр: зафиксировать ─────────────────────────
        if action == 'post_view' and method == 'POST':
            uid = int(body.get('user_id') or 0)
            pid = int(body.get('post_id') or 0)
            cur.execute("INSERT INTO post_views (post_id, user_id, created_at) VALUES (%s,%s,NOW()) ON CONFLICT DO NOTHING", (pid, uid))
            conn.commit()
            return _resp(200, {'ok': True})

        # ── Кто лайкнул / кто смотрел (для статистики) ────
        if action == 'post_likers' and method == 'GET':
            pid = int(params.get('post_id') or 0)
            cur.execute(
                """SELECT u.id, u.nick, u.avatar_url, u.is_verified FROM post_likes pl
                   JOIN users u ON u.id=pl.user_id WHERE pl.post_id=%s ORDER BY pl.created_at DESC""",
                (pid,),
            )
            return _resp(200, {'users': cur.fetchall()})

        # ── Удалить публикацию (+ каскадно уведомления) ────
        if action == 'post_delete' and method == 'POST':
            uid = int(body.get('user_id') or 0)
            pid = int(body.get('post_id') or 0)
            cur.execute("UPDATE posts SET is_removed=TRUE WHERE id=%s AND user_id=%s", (pid, uid))
            cur.execute("DELETE FROM notifications WHERE post_id=%s", (pid,))
            conn.commit()
            return _resp(200, {'ok': True})

        # ── Статистика профиля (мои посты: лайки/комменты/просмотры) ──
        if action == 'profile_stats' and method == 'GET':
            uid = int(params.get('user_id') or 0)
            cur.execute(
                """
                SELECT COUNT(*) AS posts_count,
                       COALESCE((SELECT COUNT(*) FROM post_likes pl JOIN posts p ON p.id=pl.post_id WHERE p.user_id=%s),0) AS total_likes,
                       COALESCE((SELECT COUNT(*) FROM post_comments pc JOIN posts p ON p.id=pc.post_id WHERE p.user_id=%s),0) AS total_comments,
                       COALESCE((SELECT COUNT(*) FROM post_views pv JOIN posts p ON p.id=pv.post_id WHERE p.user_id=%s),0) AS total_views
                FROM posts WHERE user_id=%s AND is_removed=FALSE
                """,
                (uid, uid, uid, uid),
            )
            stats = cur.fetchone()
            return _resp(200, {'stats': stats})

        # ══════════════════════════════════════════════════
        # ПРИВАТНОСТЬ ПРОФИЛЯ
        # ══════════════════════════════════════════════════

        # ── Получить настройки приватности ────────────────
        if action == 'privacy_get' and method == 'GET':
            uid = int(params.get('user_id') or 0)
            cur.execute("SELECT privacy_content, privacy_calls, privacy_messages FROM users WHERE id=%s", (uid,))
            row = cur.fetchone()
            cur.execute("SELECT viewer_id FROM profile_content_allowed WHERE owner_id=%s", (uid,))
            allowed = [r['viewer_id'] for r in cur.fetchall()]
            return _resp(200, {'privacy': row, 'allowed_viewers': allowed})

        # ── Обновить настройки приватности ────────────────
        if action == 'privacy_update' and method == 'POST':
            uid = int(body.get('user_id') or 0)
            fields = []
            values = []
            for key in ('privacy_content', 'privacy_calls', 'privacy_messages'):
                if key in body:
                    val = body[key]
                    if val not in ('all', 'followers', 'selected'):
                        continue
                    fields.append(f"{key}=%s")
                    values.append(val)
            if fields:
                values.append(uid)
                cur.execute(f"UPDATE users SET {', '.join(fields)} WHERE id=%s", values)
            if 'allowed_viewers' in body and isinstance(body['allowed_viewers'], list):
                cur.execute("DELETE FROM profile_content_allowed WHERE owner_id=%s", (uid,))
                for vid in body['allowed_viewers']:
                    cur.execute("INSERT INTO profile_content_allowed (owner_id, viewer_id, created_at) VALUES (%s,%s,NOW()) ON CONFLICT DO NOTHING", (uid, int(vid)))
            conn.commit()
            return _resp(200, {'ok': True})

        # ══════════════════════════════════════════════════
        # СТАТУСЫ (как в WhatsApp)
        # ══════════════════════════════════════════════════

        # ── Создать статус: текст / фото / видео ──────────
        if action == 'status_create' and method == 'POST':
            uid = int(body.get('user_id') or 0)
            s_type = body.get('type', 'text')
            content = body.get('content', '')
            caption = body.get('caption') or None
            bg_color = body.get('bg_color') or None
            if not uid or s_type not in ('text', 'photo', 'video') or not content:
                return _resp(400, {'error': 'Некорректные данные статуса'})
            if s_type == 'text' and len(content) > 100:
                return _resp(400, {'error': 'Текст статуса максимум 100 символов'})
            cur.execute(
                """INSERT INTO statuses (user_id, type, content, caption, bg_color, created_at, expires_at)
                   VALUES (%s, %s, %s, %s, %s, NOW(), NOW() + INTERVAL '24 hours')
                   RETURNING id, user_id, type, content, caption, bg_color, created_at, expires_at""",
                (uid, s_type, content, caption, bg_color),
            )
            status = cur.fetchone()
            conn.commit()
            return _resp(200, {'status': status})

        # ── Лента статусов: свои + тех, на кого подписан ──
        if action == 'statuses_feed' and method == 'GET':
            me = int(params.get('user_id') or 0)
            cur.execute("DELETE FROM status_views WHERE status_id IN (SELECT id FROM statuses WHERE expires_at <= NOW())")
            cur.execute("DELETE FROM statuses WHERE expires_at <= NOW()")
            conn.commit()
            cur.execute(
                """
                SELECT u.id AS user_id, u.nick, u.avatar_url, u.is_verified,
                       COUNT(s.id) AS status_count,
                       COUNT(s.id) FILTER (WHERE sv.id IS NULL) AS unseen_count,
                       MAX(s.created_at) AS last_status_at
                FROM statuses s
                JOIN users u ON u.id = s.user_id
                LEFT JOIN status_views sv ON sv.status_id = s.id AND sv.viewer_id = %s
                WHERE s.expires_at > NOW()
                  AND (u.id = %s OR u.id IN (SELECT following_id FROM follows WHERE follower_id = %s))
                GROUP BY u.id, u.nick, u.avatar_url, u.is_verified
                ORDER BY (u.id = %s) DESC, unseen_count DESC, last_status_at DESC
                """,
                (me, me, me, me),
            )
            return _resp(200, {'feed': cur.fetchall()})

        # ── Статусы конкретного пользователя ───────────────
        if action == 'statuses_user' and method == 'GET':
            uid = int(params.get('user_id') or 0)
            me = int(params.get('me') or 0)
            cur.execute(
                """
                SELECT s.id, s.user_id, s.type, s.content, s.caption, s.bg_color, s.created_at, s.expires_at,
                       EXISTS(SELECT 1 FROM status_views WHERE status_id=s.id AND viewer_id=%s) AS viewed
                FROM statuses s
                WHERE s.user_id=%s AND s.expires_at > NOW()
                ORDER BY s.created_at ASC
                """,
                (me, uid),
            )
            return _resp(200, {'statuses': cur.fetchall()})

        # ── Отметить статус просмотренным ──────────────────
        if action == 'status_view' and method == 'POST':
            status_id = int(body.get('status_id') or 0)
            viewer_id = int(body.get('viewer_id') or 0)
            cur.execute("SELECT user_id FROM statuses WHERE id=%s", (status_id,))
            row = cur.fetchone()
            if not row:
                return _resp(404, {'error': 'Статус не найден'})
            if row['user_id'] != viewer_id:
                cur.execute(
                    "INSERT INTO status_views (status_id, viewer_id) VALUES (%s, %s) ON CONFLICT DO NOTHING",
                    (status_id, viewer_id),
                )
                conn.commit()
            return _resp(200, {'ok': True})

        # ── Кто просмотрел статус (только автор) ───────────
        if action == 'status_views' and method == 'GET':
            status_id = int(params.get('status_id') or 0)
            uid = int(params.get('user_id') or 0)
            cur.execute("SELECT user_id FROM statuses WHERE id=%s", (status_id,))
            row = cur.fetchone()
            if not row:
                return _resp(404, {'error': 'Статус не найден'})
            if row['user_id'] != uid:
                return _resp(403, {'error': 'Нет доступа'})
            cur.execute(
                """
                SELECT u.id, u.nick, u.avatar_url, sv.viewed_at
                FROM status_views sv JOIN users u ON u.id = sv.viewer_id
                WHERE sv.status_id=%s ORDER BY sv.viewed_at DESC
                """,
                (status_id,),
            )
            return _resp(200, {'views': cur.fetchall()})

        # ── Удалить свой статус ─────────────────────────────
        if action == 'status_delete' and method == 'POST':
            status_id = int(body.get('status_id') or 0)
            uid = int(body.get('user_id') or 0)
            cur.execute("SELECT user_id FROM statuses WHERE id=%s", (status_id,))
            row = cur.fetchone()
            if not row:
                return _resp(404, {'error': 'Статус не найден'})
            if row['user_id'] != uid:
                return _resp(403, {'error': 'Нет доступа'})
            cur.execute("DELETE FROM status_views WHERE status_id=%s", (status_id,))
            cur.execute("DELETE FROM statuses WHERE id=%s", (status_id,))
            conn.commit()
            return _resp(200, {'ok': True})

        # ── Загрузка фото/видео для статуса (base64) ───────
        if action == 'upload_status_media' and method == 'POST':
            uid = int(body.get('user_id') or 0)
            data_b64 = body.get('data', '')
            ext = (body.get('ext') or 'jpg').lower()
            media_type = body.get('media_type', 'photo')
            if not uid or not data_b64:
                return _resp(400, {'error': 'Нет данных'})
            raw = base64.b64decode(data_b64)
            ct_map = {'photo': f'image/{ext}', 'video': f'video/{ext}'}
            content_type = ct_map.get(media_type, 'application/octet-stream')
            key = f"statuses/{uid}_{secrets.token_hex(8)}.{ext}"
            s3 = _s3()
            s3.put_object(Bucket=REGRU_BUCKET, Key=key, Body=raw, ContentType=content_type)
            url = _s3_url(key)
            return _resp(200, {'url': url})

        return _resp(404, {'error': 'Неизвестное действие'})
    finally:
        conn.close()