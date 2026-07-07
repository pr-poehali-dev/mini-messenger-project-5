import os
import base64
import secrets
import time
import boto3

BUCKET = 'files'

def _s3():
    return boto3.client(
        's3',
        endpoint_url='https://bucket.poehali.dev',
        aws_access_key_id=os.environ['AWS_ACCESS_KEY_ID'],
        aws_secret_access_key=os.environ['AWS_SECRET_ACCESS_KEY'],
    )

def _s3_url(key: str) -> str:
    return f"https://cdn.poehali.dev/projects/{os.environ['AWS_ACCESS_KEY_ID']}/bucket/{key}"

def _resp(status, body_dict=None, *, body_str=None):
    import json
    return {
        'statusCode': status,
        'headers': {
            'Content-Type': 'application/json',
            'Access-Control-Allow-Origin': '*',
            'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
            'Access-Control-Allow-Headers': 'Content-Type, X-User-Id, X-Auth-Token',
            'Access-Control-Max-Age': '86400',
        },
        'isBase64Encoded': False,
        'body': body_str if body_str is not None else json.dumps(body_dict or {}, default=str),
    }

def handler(event: dict, context) -> dict:
    """Загрузка медиафайлов (видео/аудио) чанками в S3"""
    if event.get('httpMethod') == 'OPTIONS':
        return {
            'statusCode': 200,
            'headers': {
                'Access-Control-Allow-Origin': '*',
                'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
                'Access-Control-Allow-Headers': 'Content-Type, X-User-Id, X-Auth-Token',
                'Access-Control-Max-Age': '86400',
            },
            'body': '',
        }

    params = event.get('queryStringParameters') or {}
    action = params.get('action', '')
    method = event.get('httpMethod', 'GET')

    # ── UPLOAD CHUNK ──────────────────────────────────────
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
        s3.put_object(Bucket=BUCKET, Key=key, Body=raw)
        print(f'[CHUNK] uid={uid} upload_id={upload_id} chunk={chunk_idx} size={len(raw)}')
        return _resp(200, {'ok': True})

    # ── UPLOAD IMAGE (single-shot, base64 body) ────────────
    if action == 'upload_image' and method == 'POST':
        import json
        raw_body = event.get('body') or '{}'
        if event.get('isBase64Encoded'):
            raw_body = base64.b64decode(raw_body).decode('utf-8')
        body = json.loads(raw_body)

        uid  = int(body.get('user_id') or 0)
        ext  = (body.get('ext') or 'png').lower()
        data = body.get('data') or ''
        if not data:
            return _resp(400, {'error': 'Нет данных'})
        raw = base64.b64decode(data)
        ct_map = {'png': 'image/png', 'jpg': 'image/jpeg', 'jpeg': 'image/jpeg'}
        content_type = ct_map.get(ext, 'application/octet-stream')
        key = f"images/{uid}/{secrets.token_hex(8)}_{int(time.time())}.{ext}"
        s3 = _s3()
        s3.put_object(Bucket=BUCKET, Key=key, Body=raw, ContentType=content_type)
        url = _s3_url(key)
        print(f'[UPLOAD_IMAGE] OK uid={uid} url={url}')
        return _resp(200, {'url': url})

    # ── ASSEMBLE CHUNKS ───────────────────────────────────
    if action == 'assemble_chunks' and method == 'POST':
        import json
        raw_body = event.get('body') or '{}'
        if event.get('isBase64Encoded'):
            raw_body = base64.b64decode(raw_body).decode('utf-8')
        body = json.loads(raw_body)

        uid        = int(body.get('user_id') or 0)
        upload_id  = body.get('upload_id', '')
        total      = int(body.get('total_chunks') or 0)
        ext        = (body.get('ext') or 'mp4').lower()
        media_type = body.get('media_type', 'video')
        if not upload_id or not total:
            return _resp(400, {'error': 'Нет данных'})
        ct_map = {'video': f'video/{ext}', 'audio': f'audio/{ext}', 'voice': 'audio/ogg'}
        content_type = ct_map.get(media_type, 'application/octet-stream')
        s3 = _s3()
        final_key = f"media/{uid}/{upload_id}.{ext}"
        mpu = s3.create_multipart_upload(Bucket=BUCKET, Key=final_key, ContentType=content_type)
        mp_id = mpu['UploadId']
        parts = []
        buf = b''
        MIN_PART = 6 * 1024 * 1024
        part_num = 1
        try:
            for i in range(total):
                chunk_key = f"chunks/{uid}/{upload_id}/{i:05d}"
                obj = s3.get_object(Bucket=BUCKET, Key=chunk_key)
                buf += obj['Body'].read()
                if len(buf) >= MIN_PART or i == total - 1:
                    resp = s3.upload_part(Bucket=BUCKET, Key=final_key, UploadId=mp_id, PartNumber=part_num, Body=buf)
                    parts.append({'PartNumber': part_num, 'ETag': resp['ETag']})
                    part_num += 1
                    buf = b''
            s3.complete_multipart_upload(Bucket=BUCKET, Key=final_key, UploadId=mp_id, MultipartUpload={'Parts': parts})
            for i in range(total):
                try: s3.delete_object(Bucket=BUCKET, Key=f"chunks/{uid}/{upload_id}/{i:05d}")
                except: pass
        except Exception as e:
            s3.abort_multipart_upload(Bucket=BUCKET, Key=final_key, UploadId=mp_id)
            print(f'[ASSEMBLE] error: {e}')
            return _resp(500, {'error': f'Ошибка сборки: {e}'})
        url = _s3_url(final_key)
        print(f'[ASSEMBLE] OK uid={uid} total={total} url={url}')
        return _resp(200, {'url': url, 'media_type': media_type})

    return _resp(404, {'error': 'Неизвестный action'})