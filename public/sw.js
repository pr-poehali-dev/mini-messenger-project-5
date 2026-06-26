const CACHE_NAME = 'vai-messenger-v5';
const ICON_URL = 'https://cdn.poehali.dev/projects/59076a76-2862-4ba6-9c95-c02c43e87c88/files/d13675c5-0092-4683-9d21-a86c2a22bd22.jpg';

// ── Установка ─────────────────────────────────────────────────────────────────
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) =>
      cache.addAll(['/', '/manifest.json'])
    )
  );
  self.skipWaiting();
});

// ── Активация — удаляем старые кэши и говорим всем клиентам обновиться ───────
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    ).then(async () => {
      await self.clients.claim();
      // Говорим всем открытым вкладкам что вышло обновление
      const clients = await self.clients.matchAll({ type: 'window' });
      clients.forEach(client => client.postMessage({ type: 'APP_UPDATED' }));
    })
  );
});

// ── Сеть: кэшируем статику, API не трогаем ───────────────────────────────────
self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;
  const url = event.request.url;
  if (url.includes('functions.poehali.dev')) return;
  if (url.includes('fonts.googleapis.com')) return;
  if (url.includes('mc.yandex.ru')) return;
  if (url.includes('cdn.poehali.dev/intertnal')) return;

  event.respondWith(
    fetch(event.request)
      .then((res) => {
        if (res && res.status === 200 && res.type !== 'opaque') {
          caches.open(CACHE_NAME).then((c) => c.put(event.request, res.clone()));
        }
        return res;
      })
      .catch(() => caches.match(event.request).then((cached) => cached || caches.match('/')))
  );
});

// ── Push-уведомления (Web Push / OneSignal) ───────────────────────────────────
self.addEventListener('push', (event) => {
  let data = { title: 'Вай Мессенджер', body: 'Новое сообщение', url: '/' };
  try {
    if (event.data) data = { ...data, ...event.data.json() };
  } catch {}

  event.waitUntil(
    self.registration.showNotification(data.title, {
      body: data.body,
      icon: ICON_URL,
      badge: ICON_URL,
      tag: data.tag || 'vai-msg',
      renotify: true,
      vibrate: [200, 100, 200],
      sound: '/notification.mp3',
      data: { url: data.url || '/' },
      actions: [
        { action: 'open', title: 'Открыть' },
        { action: 'close', title: 'Закрыть' }
      ]
    })
  );
});

// ── Клик по уведомлению — открываем приложение ────────────────────────────────
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  if (event.action === 'close') return;

  const targetUrl = event.notification.data?.url || '/';

  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clients) => {
      for (const client of clients) {
        if (client.url.includes(self.location.origin) && 'focus' in client) {
          client.focus();
          client.navigate(targetUrl);
          return;
        }
      }
      return self.clients.openWindow(targetUrl);
    })
  );
});

// ── Фоновый поллинг — проверяем новые сообщения каждые 30 сек ────────────────
self.addEventListener('periodicsync', (event) => {
  if (event.tag === 'check-messages') {
    event.waitUntil(checkNewMessages());
  }
});

async function checkNewMessages() {
  try {
    const cache = await caches.open(CACHE_NAME);
    const userResp = await cache.match('/sw-user-data');
    if (!userResp) return;
    const { userId } = await userResp.json();
    if (!userId) return;

    const resp = await fetch(
      `https://functions.poehali.dev/b927178a-1937-4d4d-8fd6-2a1ffe4d52be?action=notifications&user_id=${userId}`
    );
    const data = await resp.json();
    const unread = Number(data.unread) || 0;

    if (unread > 0 && data.notifications?.length) {
      const latest = data.notifications[0];
      const labels = {
        new_message: 'Новое сообщение',
        missed_call: 'Пропущенный звонок',
        follow: 'Новый подписчик',
        group_invite: 'Приглашение в группу',
      };
      const title = labels[latest.type] || 'Вай Мессенджер';
      const body = latest.from_nick ? `@${latest.from_nick}` : 'Новое уведомление';

      await self.registration.showNotification(title, {
        body,
        icon: ICON_URL,
        badge: ICON_URL,
        tag: `notif-${latest.id}`,
        renotify: true,
        vibrate: [200, 100, 200],
        data: { url: latest.chat_id ? `/?chat=${latest.chat_id}` : '/' }
      });
    }
  } catch {}
}

// ── Сообщения от страницы → SW (сохраняем userId для фонового поллинга) ───────
self.addEventListener('message', async (event) => {
  if (event.data?.type === 'SET_USER') {
    const cache = await caches.open(CACHE_NAME);
    await cache.put('/sw-user-data', new Response(JSON.stringify({ userId: event.data.userId })));
  }
  if (event.data?.type === 'SHOW_NOTIFICATION') {
    const { title, body, url } = event.data;
    await self.registration.showNotification(title || 'Вай Мессенджер', {
      body: body || '',
      icon: ICON_URL,
      badge: ICON_URL,
      tag: 'vai-msg-' + Date.now(),
      renotify: true,
      vibrate: [200, 100, 200],
      data: { url: url || '/' }
    });
  }
});