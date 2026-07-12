import { useState, useRef, useEffect, useCallback } from 'react';
import Icon from '@/components/ui/icon';
import { playSendSound, startRingback, stopRingback } from '@/lib/sounds';
import { useLang } from '@/lib/i18n';

declare global {
  interface Window {
    __hideSplash?: () => void;
    OneSignalDeferred?: Array<(os: OneSignalType) => void>;
  }
}
type OneSignalType = {
  login: (id: string) => Promise<void>;
  User: { PushSubscription: { optIn: () => Promise<void> } };
  Notifications: { requestPermission: () => Promise<void>; permissionNative: string };
};

const API = 'https://functions.poehali.dev/b927178a-1937-4d4d-8fd6-2a1ffe4d52be';

// ── helpers ──────────────────────────────────────────────────────────────────
function getDeviceId() {
  let id = localStorage.getItem('orbit_device');
  if (!id) { id = Math.random().toString(36).slice(2) + Date.now(); localStorage.setItem('orbit_device', id); }
  return id;
}
 
const api = async (action: string, method = 'GET', body?: object): Promise<Record<string, unknown>> => {
  try {
    const r = await fetch(`${API}?action=${action}`, {
      method, headers: { 'Content-Type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined,
    });
    const json = await r.json();
    if (!r.ok && !json.error) json.error = `Ошибка сервера (${r.status})`;
    return json;
  } catch {
    return { error: 'Нет соединения. Проверь интернет и попробуй снова.' };
  }
};

const UPLOAD_API = 'https://functions.poehali.dev/3c36c336-feb4-4487-884a-5cde1fbaba5e';

// Загрузка бинарного чанка через отдельную функцию
const apiChunk = async (uid: number, upload_id: string, chunk_index: number, data: ArrayBuffer): Promise<{ok: boolean; error?: string}> => {
  try {
    console.log(`[CHUNK] sending chunk ${chunk_index} size=${data.byteLength} to ${UPLOAD_API}`);
    const r = await fetch(`${UPLOAD_API}?action=upload_chunk&user_id=${uid}&upload_id=${upload_id}&chunk_index=${chunk_index}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/octet-stream' },
      body: data,
    });
    const text = await r.text();
    console.log(`[CHUNK] response ${r.status}: ${text}`);
    return { ok: r.ok, error: r.ok ? undefined : `HTTP ${r.status}: ${text}` };
  } catch (e) {
    console.error(`[CHUNK] fetch error:`, e);
    return { ok: false, error: String(e) };
  }
};

// Сборка чанков через отдельную функцию
const apiAssemble = async (body: object): Promise<Record<string, unknown>> => {
  try {
    const r = await fetch(`${UPLOAD_API}?action=assemble_chunks`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    return await r.json();
  } catch {
    return { error: 'Ошибка сборки' };
  }
};
const fmtTime = (iso: string | null) => {
  if (!iso) return '';
  const d = new Date(iso);
  const today = new Date();
  if (d.toDateString() === today.toDateString())
    return d.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
  return d.toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit' });
};
const fmtLastSeen = (iso: string | null) => {
  if (!iso) return '';
  return 'был(а) ' + new Date(iso).toLocaleString('ru-RU', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
};
const Avatar = ({ url, nick, size = 40, online }: { url?: string | null; nick: string; size?: number; online?: boolean }) => (
  <div className="relative shrink-0" style={{ width: size, height: size }}>
    {url
      ? <img src={url} className="rounded-full object-cover w-full h-full" />
      : <div className="rounded-full bg-gradient-to-br from-accent to-primary flex items-center justify-center font-display font-bold text-white w-full h-full" style={{ fontSize: size * 0.38 }}>{nick.slice(0, 1).toUpperCase()}</div>
    }
    {online && <span className="absolute -bottom-0.5 -right-0.5 w-3 h-3 rounded-full bg-green-400 border-2 border-card" />}
  </div>
);

// Значок верификации разработчика — синяя галочка с лёгким покачиванием
const VerifiedBadge = ({ size = 16 }: { size?: number }) => (
  <span className="inline-flex shrink-0 animate-badge-sway" style={{ width: size, height: size }} title="Разработчик Вай Мессенджера">
    <svg viewBox="0 0 22 22" width={size} height={size} fill="none">
      <path d="M11 1.5l2.2 1.27 2.53-.4 1.27 2.2 2.2 1.27-.4 2.53.4 2.53-2.2 1.27-1.27 2.2-2.53-.4L11 15.64l-2.2-1.27-2.53.4-1.27-2.2-2.2-1.27.4-2.53-.4-2.53 2.2-1.27 1.27-2.2 2.53.4L11 1.5z" fill="#2196F3" />
      <path d="M7.5 11l2.2 2.2 4.8-5.4" stroke="#fff" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" fill="none" />
    </svg>
  </span>
);

// ── types ─────────────────────────────────────────────────────────────────────
type User = { id: number; nick: string; avatar_url?: string | null; profile_complete?: boolean; is_online?: boolean; is_verified?: boolean };
type Profile = User & { city?: string; birthdate?: string; about?: string; is_online?: boolean; last_seen?: string; followers: number; following: number; i_follow?: boolean; i_blocked?: boolean };
type ChatItem = { chat_id: number; kind: 'dm' | 'group'; peer_id?: number; peer_nick?: string; peer_avatar?: string | null; peer_online?: boolean; peer_verified?: boolean; group_id?: number; group_name?: string; group_avatar?: string | null; last_text?: string | null; last_at?: string | null; unread_count?: number };
type Message = { id: number; sender_id: number; sender_nick: string; sender_avatar?: string | null; sender_verified?: boolean; text?: string | null; image_url?: string | null; media_type?: string | null; media_url?: string | null; created_at: string; is_removed?: boolean; is_read?: boolean; reactions?: { emoji: string; user_id: number }[] };
type Tab = 'feed' | 'search' | 'chats' | 'notifications' | 'profile';
type Post = { id: number; user_id: number; nick: string; avatar_url?: string | null; is_verified?: boolean; type: 'photo' | 'video' | 'text'; content: string; caption?: string | null; created_at: string; likes_count: number; comments_count: number; views_count: number; liked_by_me: boolean };
type PostComment = { id: number; post_id: number; user_id: number; nick: string; avatar_url?: string | null; is_verified?: boolean; text: string; reply_to_user_id?: number | null; reply_to_nick?: string | null; created_at: string };
type Notif = { id: number; type: string; from_user_id?: number; from_nick?: string; from_avatar?: string | null; chat_id?: number; group_id?: number; payload?: string; is_read: boolean; created_at: string };
type GroupInfo = { id: number; name: string; about?: string; photo_url?: string | null; invite_token: string; owner_id: number; my_role?: string; member_count: number; is_public?: boolean };
type GroupMember = User & { role: string };
type StatusItem = { id: number; user_id: number; type: 'text' | 'photo' | 'video'; content: string; caption?: string | null; bg_color?: string | null; created_at: string; expires_at: string; viewed?: boolean };
type StatusFeedItem = { user_id: number; nick: string; avatar_url?: string | null; is_verified?: boolean; status_count: number; unseen_count: number; last_status_at: string };

// ── screens ───────────────────────────────────────────────────────────────────
type Screen =
  | { name: 'login' }
  | { name: 'setup' }
  | { name: 'tabs'; tab: Tab }
  | { name: 'chat'; chatId: number; peer?: User; groupName?: string; groupId?: number; groupPhotoUrl?: string | null }
  | { name: 'user_profile'; userId: number }
  | { name: 'followers'; userId: number; mode: 'followers' | 'following' }
  | { name: 'new_group' }
  | { name: 'group_info'; groupId: number; chatId: number }
  | { name: 'status_create' }
  | { name: 'status_view'; userId: number };

export default function Index() {
  const [user, setUser] = useState<User | null>(() => {
    const r = localStorage.getItem('orbit_user'); return r ? JSON.parse(r) : null;
  });
  const [screen, setScreen] = useState<Screen>(() => {
    const r = localStorage.getItem('orbit_user');
    if (r) { const u = JSON.parse(r); return u.profile_complete ? { name: 'tabs', tab: 'chats' } : { name: 'setup' }; }
    return { name: 'login' };
  });
  const [loginError, setLoginError] = useState('');
  const didLogout = useRef(false); // флаг ручного выхода — блокирует автовход
  // Системная тема — следим за prefers-color-scheme
  const getSystemDark = () => window.matchMedia('(prefers-color-scheme: dark)').matches;
  const [lightTheme, setLightTheme] = useState(() => !getSystemDark());

  useEffect(() => {
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const onChange = (e: MediaQueryListEvent) => setLightTheme(!e.matches);
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);

  useEffect(() => {
    if (!lightTheme) {
      document.documentElement.classList.add('dark');
    } else {
      document.documentElement.classList.remove('dark');
    }
  }, [lightTheme]);

  const push = (s: Screen) => setScreen(s);
  const back = () => setScreen(user ? { name: 'tabs', tab: 'chats' } : { name: 'login' });

  // Свайп назад — edge swipe от левого края
  useEffect(() => {
    let startX = 0;
    let startY = 0;
    const onStart = (e: TouchEvent) => {
      startX = e.touches[0].clientX;
      startY = e.touches[0].clientY;
    };
    const onEnd = (e: TouchEvent) => {
      const dx = e.changedTouches[0].clientX - startX;
      const dy = Math.abs(e.changedTouches[0].clientY - startY);
      // Свайп вправо от левого края (первые 30px экрана), горизонтальный
      if (startX < 30 && dx > 60 && dy < 80) {
        back();
      }
    };
    document.addEventListener('touchstart', onStart, { passive: true });
    document.addEventListener('touchend', onEnd, { passive: true });
    return () => {
      document.removeEventListener('touchstart', onStart);
      document.removeEventListener('touchend', onEnd);
    };
  }, [screen]); // eslint-disable-line react-hooks/exhaustive-deps

  // При открытии приложения — автовход по device_id (только если не нажимали "Выйти")
  useEffect(() => {
    if (user || didLogout.current) return;
    let cancelled = false;
    const device_id = getDeviceId();
    api('login', 'POST', { nick: '', device_id }).then(data => {
      if (cancelled) return;
      if (data.user) {
        const u = data.user as User & { profile_complete: boolean };
        localStorage.setItem('orbit_user', JSON.stringify(u));
        setUser(u);
        setScreen(u.profile_complete ? { name: 'tabs', tab: 'chats' } : { name: 'setup' });
      } else {
        // Нет сохранённой сессии — показываем экран логина, убираем splash
        if (typeof window.__hideSplash === 'function') window.__hideSplash();
      }
    }).catch(() => {
      if (typeof window.__hideSplash === 'function') window.__hideSplash();
    });
    return () => { cancelled = true; };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const login = async (nick: string, password: string) => {
    setLoginError('');
    const data = await api('login', 'POST', { nick: nick.trim().toLowerCase(), password, device_id: getDeviceId() });
    if (data.error) { setLoginError(data.error as string); return; }
    if (!data.user) { setLoginError('Нет соединения. Проверь интернет и попробуй снова.'); return; }
    const u = data.user as User & { profile_complete: boolean };
    localStorage.setItem('orbit_user', JSON.stringify(u));
    setUser(u);
    setScreen(u.profile_complete ? { name: 'tabs', tab: 'chats' } : { name: 'setup' });
  };

  const loginByNick = async (nick: string, password: string) => {
    setLoginError('');
    const data = await api('login_by_nick', 'POST', { nick: nick.trim().toLowerCase(), password, device_id: getDeviceId() });
    if (data.error) { setLoginError(data.error as string); return; }
    if (!data.user) { setLoginError('Нет соединения. Проверь интернет и попробуй снова.'); return; }
    const u = data.user as User & { profile_complete: boolean };
    localStorage.setItem('orbit_user', JSON.stringify(u));
    setUser(u);
    setScreen(u.profile_complete ? { name: 'tabs', tab: 'chats' } : { name: 'setup' });
  };

  const logout = () => {
    if (user) api('offline', 'POST', { user_id: user.id });
    didLogout.current = true;
    localStorage.removeItem('orbit_user');
    setUser(null);
    setScreen({ name: 'login' });
  };

  const deleteAccount = async () => {
    if (!user) return;
    await api('delete_account', 'POST', { user_id: user.id });
    didLogout.current = true;
    localStorage.removeItem('orbit_user');
    setUser(null);
    setScreen({ name: 'login' });
  };

  // Останавливаем все фоновые запросы когда вкладка/экран неактивны
  const [isVisible, setIsVisible] = useState(!document.hidden);
  useEffect(() => {
    const handler = () => {
      setIsVisible(!document.hidden);
      if (document.hidden) {
        // Экран скрыт — ставим офлайн
        const u = JSON.parse(localStorage.getItem('orbit_user') || 'null');
        if (u?.id) api('offline', 'POST', { user_id: u.id });
      }
    };
    document.addEventListener('visibilitychange', handler);
    return () => document.removeEventListener('visibilitychange', handler);
  }, []);

  // Входящие звонки и уведомления — state
  const [incomingCall, setIncomingCall] = useState<{ callId: string; kind: string; nick: string; avatar_url?: string | null; callerId: number } | null>(null);
  const [globalCall, setGlobalCall] = useState<{ kind: 'audio' | 'video'; callId: string; peer: User; outgoing?: boolean } | null>(null);
  const lastCallSigId = useRef(0);
  const lastNotifId = useRef(0);
  const [pendingCall, setPendingCall] = useState<{ kind: 'audio' | 'video' } | null>(null);
  const globalCallRef = useRef(globalCall);
  const incomingCallRef = useRef(incomingCall);
  useEffect(() => { globalCallRef.current = globalCall; }, [globalCall]);
  useEffect(() => { incomingCallRef.current = incomingCall; }, [incomingCall]);

  // Единый ping: онлайн + звонки + уведомления — 1 запрос вместо 3, каждые 8 сек
  useEffect(() => {
    if (!user) return;

    if ('serviceWorker' in navigator && navigator.serviceWorker.controller) {
      navigator.serviceWorker.controller.postMessage({ type: 'SET_USER', userId: user.id });
    }
    if (window.OneSignalDeferred) {
      window.OneSignalDeferred.push(async (OneSignal) => {
        try {
          await OneSignal.login(String(user.id));
          if (OneSignal.Notifications.permissionNative === 'default') await OneSignal.Notifications.requestPermission();
          await OneSignal.User.PushSubscription.optIn();
        } catch (_ignored) { /* push не поддерживается */ }
      });
    }
    if (typeof window.__hideSplash === 'function') window.__hideSplash();

    const doPing = async () => {
      if (document.hidden) return;
      const d = await api('ping', 'POST', { user_id: user.id, after_sig: lastCallSigId.current, after_not: lastNotifId.current });
      if (d.deleted) {
        localStorage.removeItem('orbit_user');
        didLogout.current = true;
        setUser(null); setScreen({ name: 'login' }); setLoginError('Ваш аккаунт был удалён.');
        return;
      }
      const sigs: { id: number }[] = d.signals || [];
      if (sigs.length) lastCallSigId.current = sigs[sigs.length - 1].id;
      const inc = d.incoming as { call_id: string; kind: string; nick: string; avatar_url?: string | null; caller_id: number } | null;
      if (inc && !globalCallRef.current && !incomingCallRef.current) {
        setIncomingCall({ callId: inc.call_id, kind: inc.kind, nick: inc.nick, avatar_url: inc.avatar_url, callerId: inc.caller_id });
      }
      const notifs = (d.notifs as Array<{ id: number; type: string; from_nick?: string }>) || [];
      if (notifs.length && lastNotifId.current > 0) {
        const labels: Record<string, string> = { new_message: '💬 Новое сообщение', missed_call: '📞 Пропущенный звонок', follow: '👤 Новый подписчик', group_invite: '👥 Приглашение в группу' };
        const sw = navigator.serviceWorker?.controller;
        notifs.forEach(n => { if (sw) sw.postMessage({ type: 'SHOW_NOTIFICATION', title: labels[n.type] || 'Вай Мессенджер', body: n.from_nick ? `@${n.from_nick}` : '' }); });
      }
      if (notifs.length) lastNotifId.current = Math.max(...notifs.map(n => n.id));
    };

    doPing();
    const iv = setInterval(doPing, 20000);
    const off = () => api('offline', 'POST', { user_id: user.id });
    window.addEventListener('beforeunload', off);
    return () => { clearInterval(iv); window.removeEventListener('beforeunload', off); };
  }, [user]);  

  if (screen.name === 'login' || !user) return <LoginScreen onRegister={login} onLogin={loginByNick} error={loginError} setError={setLoginError} />;
  if (screen.name === 'setup') return <SetupScreen user={user} onDone={(u) => { setUser(u); localStorage.setItem('orbit_user', JSON.stringify(u)); push({ name: 'tabs', tab: 'chats' }); }} />;

  const renderScreen = () => {
    if (screen.name === 'chat') return <ChatScreen user={user} chatId={screen.chatId} peer={screen.peer} groupName={screen.groupName} groupId={screen.groupId} groupPhotoUrl={screen.groupPhotoUrl}
      onBack={() => { setPendingCall(null); push({ name: 'tabs', tab: 'chats' }); }}
      onOpenProfile={(id) => push({ name: 'user_profile', userId: id })}
      onOpenGroup={(gid, chatId) => push({ name: 'group_info', groupId: gid, chatId })}
      autoCall={pendingCall}
      onCallStarted={() => setPendingCall(null)} />;
    if (screen.name === 'user_profile') return <UserProfileScreen me={user} userId={screen.userId} onBack={back}
      onOpenChat={async (peerId) => { const d = await api('open_chat', 'POST', { user_id: user.id, peer_id: peerId }); push({ name: 'chat', chatId: d.chat_id as number, peer: d.peer as User }); }}
      onFollowers={(uid, mode) => push({ name: 'followers', userId: uid, mode })}
      onCall={async (peer, kind) => {
        const d = await api('open_chat', 'POST', { user_id: user.id, peer_id: peer.id });
        setPendingCall({ kind });
        push({ name: 'chat', chatId: d.chat_id as number, peer: (d.peer as User) || peer });
      }} />;
    if (screen.name === 'followers') return <FollowersScreen userId={screen.userId} mode={screen.mode} me={user} onBack={back} onOpenProfile={(id) => push({ name: 'user_profile', userId: id })} />;
    if (screen.name === 'new_group') return <NewGroupScreen user={user} onBack={() => push({ name: 'tabs', tab: 'chats' })}
      onCreated={(chatId, groupName, groupId) => push({ name: 'group_info', groupId, chatId })} />;
    if (screen.name === 'group_info') return <GroupInfoScreen user={user} groupId={screen.groupId} chatId={screen.chatId}
      onBack={() => push({ name: 'tabs', tab: 'chats' })}
      onOpenChat={(name, photoUrl) => push({ name: 'chat', chatId: screen.chatId, groupId: screen.groupId, groupName: name, groupPhotoUrl: photoUrl })}
      onOpenProfile={(id) => push({ name: 'user_profile', userId: id })} />;
    if (screen.name === 'status_create') return <StatusCreateScreen user={user} onBack={() => push({ name: 'tabs', tab: 'feed' })} onCreated={() => push({ name: 'tabs', tab: 'feed' })} />;
    if (screen.name === 'status_view') return <StatusViewScreen me={user} userId={screen.userId} onBack={() => push({ name: 'tabs', tab: 'feed' })}
      onOpenChat={async (peerId) => { const d = await api('open_chat', 'POST', { user_id: user.id, peer_id: peerId }); push({ name: 'chat', chatId: d.chat_id as number, peer: d.peer as User }); }}
      onOpenProfile={(uid) => push({ name: 'user_profile', userId: uid })} />;
    const tab = (screen as { name: 'tabs'; tab: Tab }).tab;
    return (
      <TabsShell tab={tab} onTab={(t) => push({ name: 'tabs', tab: t })} user={user}>
        {tab === 'feed' && <FeedTab user={user}
          onOpenProfile={(id) => push({ name: 'user_profile', userId: id })}
          onCreateStatus={() => push({ name: 'status_create' })}
          onOpenStatus={(uid) => push({ name: 'status_view', userId: uid })} />}
        {tab === 'search' && <SearchTab user={user} onOpenProfile={(id) => push({ name: 'user_profile', userId: id })} />}
        {tab === 'chats' && <ChatsTab user={user}
          onOpenChat={(c) => push({ name: 'chat', chatId: c.chat_id, peer: c.peer_id ? { id: c.peer_id, nick: c.peer_nick!, avatar_url: c.peer_avatar } : undefined, groupName: c.group_name, groupId: c.group_id, groupPhotoUrl: c.group_avatar })}
          onNewGroup={() => push({ name: 'new_group' })}
          onOpenGroup={(gid, chatId) => push({ name: 'group_info', groupId: gid, chatId })}
          onOpenNotifications={() => push({ name: 'tabs', tab: 'notifications' })} />}
        {tab === 'notifications' && <NotificationsTab user={user}
          onOpenChat={(chatId) => push({ name: 'chat', chatId })}
          onOpenProfile={(id) => push({ name: 'user_profile', userId: id })}
          onBack={() => push({ name: 'tabs', tab: 'chats' })}
          onCall={async (peerId, peerNick, peerAvatar, kind) => {
            const d = await api('open_chat', 'POST', { user_id: user.id, peer_id: peerId });
            const callId = `call_${Date.now()}`;
            setGlobalCall({ kind, callId, outgoing: true, peer: { id: peerId, nick: peerNick, avatar_url: peerAvatar } });
            push({ name: 'chat', chatId: d.chat_id as number, peer: (d.peer as User) || { id: peerId, nick: peerNick, avatar_url: peerAvatar } });
          }} />}
        {tab === 'profile' && <ProfileTab user={user} onLogout={logout} onUpdate={(u) => { setUser(u); localStorage.setItem('orbit_user', JSON.stringify(u)); }} onFollowers={(uid, mode) => push({ name: 'followers', userId: uid, mode })} lightTheme={lightTheme} onToggleTheme={() => setLightTheme(v => !v)} onDeleteAccount={deleteAccount} />}
      </TabsShell>
    );
  };

  return (
    <>
      {renderScreen()}
      {/* Баннер входящего звонка */}
      {incomingCall && !globalCall && (
        <IncomingCallBanner
          caller={{ nick: incomingCall.nick, avatar_url: incomingCall.avatar_url }}
          kind={incomingCall.kind}
          onAccept={() => {
            setGlobalCall({ kind: incomingCall.kind as 'audio' | 'video', callId: incomingCall.callId, peer: { id: incomingCall.callerId, nick: incomingCall.nick, avatar_url: incomingCall.avatar_url } });
            setIncomingCall(null);
          }}
          onReject={() => {
            api('call_signal', 'POST', { call_id: incomingCall.callId, from_user_id: user.id, to_user_id: incomingCall.callerId, type: 'reject', payload: '{}' });
            setIncomingCall(null);
          }}
        />
      )}
      {/* Глобальный WebRTC звонок (входящий принятый / исходящий перезвонить) */}
      {globalCall && (
        <WebRTCCall
          user={user}
          peer={globalCall.peer}
          callId={globalCall.callId}
          kind={globalCall.kind}
          outgoing={globalCall.outgoing ?? false}
          onEnd={() => setGlobalCall(null)}
        />
      )}
    </>
  );
}

// ══════════════════════════════════════════════════════════════════════════════
// LOGIN
// ══════════════════════════════════════════════════════════════════════════════
function LoginScreen({ onRegister, onLogin, error, setError }: {
  onRegister: (nick: string, password: string) => void;
  onLogin: (nick: string, password: string) => void;
  error: string; setError: (e: string) => void;
}) {
  const { t } = useLang();
  const [tab, setTab] = useState<'start' | 'login' | 'register'>('start');
  const [nick, setNick] = useState('');
  const [password, setPassword] = useState('');
  const [showPw, setShowPw] = useState(false);
  const [nickStatus, setNickStatus] = useState<'idle' | 'checking' | 'ok' | 'taken'>('idle');
  const [nickHint, setNickHint] = useState('');
  const [loading, setLoading] = useState(false);

  useEffect(() => { setError(''); setNick(''); setPassword(''); setNickStatus('idle'); setNickHint(''); }, [tab]); // eslint-disable-line

  useEffect(() => {
    if (tab !== 'register') return;
    const q = nick.trim().toLowerCase();
    if (q.length < 2) { setNickStatus('idle'); setNickHint(''); return; }
    setNickStatus('checking');
    const tm = setTimeout(async () => {
      const d = await api(`check_nick&nick=${encodeURIComponent(q)}&user_id=0`);
      if (d.available) { setNickStatus('ok'); setNickHint(t('Ник свободен!')); }
      else { setNickStatus('taken'); setNickHint(d.error || t('Ник уже занят')); }
    }, 500);
    return () => clearTimeout(tm);
  }, [nick, tab]);

  const inputCls = (extra = '') =>
    `w-full bg-slate-50 border-2 rounded-2xl px-4 py-3.5 outline-none focus:border-blue-500 transition-all text-slate-800 text-base ${extra}`;

  const btnPrimary = 'w-full py-4 rounded-2xl font-bold text-white text-base mb-3 transition-all active:scale-[0.98] disabled:opacity-40';
  const btnSecondary = 'w-full py-3.5 rounded-2xl font-semibold text-slate-600 text-sm bg-slate-100 active:bg-slate-200 transition-all';

  const handleRegister = async () => {
    if (loading || nick.trim().length < 2 || nickStatus !== 'ok' || password.length < 4) return;
    setLoading(true);
    await onRegister(nick, password);
    setLoading(false);
  };

  const handleLogin = async () => {
    if (loading || nick.trim().length < 2 || !password) return;
    setLoading(true);
    await onLogin(nick, password);
    setLoading(false);
  };

  return (
    <div className="flex flex-col overflow-hidden relative"
      style={{ background: 'linear-gradient(160deg, #1a56db 0%, #1e3a8a 55%, #0f172a 100%)', height: '100dvh', paddingTop: 'env(safe-area-inset-top)' }}>
      <div className="absolute top-[-60px] right-[-60px] w-72 h-72 rounded-full opacity-20 pointer-events-none"
        style={{ background: 'radial-gradient(circle, #60a5fa, transparent)' }} />
      <div className="absolute bottom-[35%] left-[-80px] w-56 h-56 rounded-full opacity-10 pointer-events-none"
        style={{ background: 'radial-gradient(circle, #93c5fd, transparent)' }} />

      {/* Лого */}
      <div className="flex-1 flex flex-col items-center justify-center px-6 pb-6 pt-16">
        <div className="w-20 h-20 rounded-[24px] mb-5 flex items-center justify-center shadow-2xl"
          style={{ background: 'rgba(255,255,255,0.15)', backdropFilter: 'blur(12px)', border: '1px solid rgba(255,255,255,0.22)' }}>
          <svg width="46" height="42" viewBox="0 0 62 56" fill="none">
            <rect x="2" y="4" width="34" height="26" rx="9" fill="white" fillOpacity="0.95"/>
            <path d="M10 30 L4 42 L20 30 Z" fill="white" fillOpacity="0.95"/>
            <rect x="22" y="22" width="36" height="26" rx="9" fill="white" fillOpacity="0.4"/>
            <path d="M50 48 L58 58 L42 48 Z" fill="white" fillOpacity="0.4"/>
          </svg>
        </div>
        <h1 className="text-white font-bold text-2xl tracking-tight mb-1">{t('Вай Мессенджер')}</h1>
        <p className="text-blue-200 text-sm">{t('Быстро. Просто. Надёжно.')}</p>
      </div>

      {/* Карточка */}
      <div className="rounded-t-[32px] px-6 pt-7 pb-10 bg-white dark:bg-slate-900">

        {/* START */}
        {tab === 'start' && (
          <>
            <h2 className="text-slate-800 dark:text-white font-bold text-xl mb-1">{t('Добро пожаловать')}</h2>
            <p className="text-slate-400 text-sm mb-7">{t('Войди или создай новый аккаунт')}</p>
            <button onClick={() => setTab('register')} className={btnPrimary}
              style={{ background: 'linear-gradient(135deg, #2563eb, #1d4ed8)' }}>
              {t('Создать аккаунт')}
            </button>
            <button onClick={() => setTab('login')} className={btnSecondary}>
              {t('Уже есть аккаунт? Войти')}
            </button>
          </>
        )}

        {/* REGISTER */}
        {tab === 'register' && (
          <>
            <button onClick={() => setTab('start')} className="flex items-center gap-1.5 text-slate-400 text-sm mb-5 -ml-1">
              <Icon name="ArrowLeft" size={16} /> {t('Назад')}
            </button>
            <h2 className="text-slate-800 dark:text-white font-bold text-xl mb-1">{t('Создать аккаунт')}</h2>
            <p className="text-slate-400 text-sm mb-5">{t('Придумай ник и пароль')}</p>

            {/* Ник */}
            <label className="text-xs font-semibold text-slate-500 mb-1.5 block">{t('Ник')}</label>
            <div className="relative mb-4">
              <span className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400 font-medium select-none">@</span>
              <input value={nick} autoFocus placeholder="my_nickname" maxLength={30}
                onChange={e => setNick(e.target.value.replace(/[^a-zA-Z0-9_]/g, '').toLowerCase())}
                className={inputCls(`pl-9 pr-10 ${nickStatus === 'ok' ? 'border-green-400' : nickStatus === 'taken' ? 'border-red-400' : 'border-slate-200'}`)} />
              <span className="absolute right-4 top-1/2 -translate-y-1/2">
                {nickStatus === 'checking' && <span className="w-4 h-4 border-2 border-blue-500 border-t-transparent rounded-full animate-spin block" />}
                {nickStatus === 'ok' && <Icon name="CheckCircle" size={17} className="text-green-500" />}
                {nickStatus === 'taken' && <Icon name="XCircle" size={17} className="text-red-400" />}
              </span>
            </div>
            <p className={`text-xs mb-4 -mt-3 px-1 h-4 ${nickStatus === 'ok' ? 'text-green-500' : nickStatus === 'taken' ? 'text-red-400' : 'text-slate-400'}`}>
              {nickHint || t('Только латиница, цифры и _')}
            </p>

            {/* Пароль */}
            <label className="text-xs font-semibold text-slate-500 mb-1.5 block">{t('Пароль')}</label>
            <div className="relative mb-5">
              <input value={password} type={showPw ? 'text' : 'password'} placeholder={t('Минимум 4 символа')}
                onChange={e => setPassword(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && handleRegister()}
                className={inputCls('pr-12 border-slate-200')} />
              <button type="button" onClick={() => setShowPw(v => !v)}
                className="absolute right-4 top-1/2 -translate-y-1/2 text-slate-400">
                <Icon name={showPw ? 'EyeOff' : 'Eye'} size={18} />
              </button>
            </div>

            {error && <p className="text-red-500 text-sm mb-4 px-1">{error}</p>}
            <button onClick={handleRegister}
              disabled={loading || nick.trim().length < 2 || nickStatus !== 'ok' || password.length < 4}
              className={btnPrimary} style={{ background: 'linear-gradient(135deg, #2563eb, #1d4ed8)' }}>
              {loading ? t('Создаю...') : t('Зарегистрироваться')}
            </button>
            <button onClick={() => setTab('login')} className={btnSecondary}>
              {t('Уже есть аккаунт? Войти')}
            </button>
          </>
        )}

        {/* LOGIN */}
        {tab === 'login' && (
          <>
            <button onClick={() => setTab('start')} className="flex items-center gap-1.5 text-slate-400 text-sm mb-5 -ml-1">
              <Icon name="ArrowLeft" size={16} /> {t('Назад')}
            </button>
            <h2 className="text-slate-800 dark:text-white font-bold text-xl mb-1">{t('С возвращением!')}</h2>
            <p className="text-slate-400 text-sm mb-5">{t('Введи ник и пароль')}</p>

            <label className="text-xs font-semibold text-slate-500 mb-1.5 block">{t('Ник')}</label>
            <div className="relative mb-4">
              <span className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400 font-medium select-none">@</span>
              <input value={nick} autoFocus placeholder="my_nickname" maxLength={30}
                onChange={e => setNick(e.target.value.replace(/[^a-zA-Z0-9_]/g, '').toLowerCase())}
                className={inputCls('pl-9 border-slate-200')} />
            </div>

            <label className="text-xs font-semibold text-slate-500 mb-1.5 block">{t('Пароль')}</label>
            <div className="relative mb-5">
              <input value={password} type={showPw ? 'text' : 'password'} placeholder={t('Твой пароль')}
                onChange={e => setPassword(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && handleLogin()}
                className={inputCls('pr-12 border-slate-200')} />
              <button type="button" onClick={() => setShowPw(v => !v)}
                className="absolute right-4 top-1/2 -translate-y-1/2 text-slate-400">
                <Icon name={showPw ? 'EyeOff' : 'Eye'} size={18} />
              </button>
            </div>

            {error && <p className="text-red-500 text-sm mb-4 px-1">{error}</p>}
            <button onClick={handleLogin}
              disabled={loading || nick.trim().length < 2 || !password}
              className={btnPrimary} style={{ background: 'linear-gradient(135deg, #2563eb, #1d4ed8)' }}>
              {loading ? t('Вхожу...') : t('Войти')}
            </button>
            <button onClick={() => setTab('register')} className={btnSecondary}>
              {t('Нет аккаунта? Зарегистрироваться')}
            </button>
          </>
        )}

      </div>
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════════════
// SETUP PROFILE
// ══════════════════════════════════════════════════════════════════════════════
function SetupScreen({ user, onDone }: { user: User; onDone: (u: User) => void }) {
  const { t } = useLang();
  const [avatar, setAvatar] = useState<string | null>(null);
  const [city, setCity] = useState('');
  const [birthdate, setBirthdate] = useState('');
  const [about, setAbout] = useState('');
  const [saving, setSaving] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const pickAvatar = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]; if (!file) return;
    const reader = new FileReader();
    reader.onload = () => setAvatar(reader.result as string);
    reader.readAsDataURL(file);
  };

  const save = async () => {
    setSaving(true);
    let avatar_url = null;
    if (avatar) {
      const [header, b64] = avatar.split(',');
      const ext = header.includes('png') ? 'png' : 'jpg';
      const d = await api('upload_avatar', 'POST', { user_id: user.id, data: b64, ext });
      avatar_url = d.url;
    }
    const d = await api('profile_update', 'POST', { user_id: user.id, avatar_url, city: city || null, birthdate: birthdate || null, about: about || null });
    setSaving(false);
    onDone(d.user);
  };

  const canSave = city.trim() && birthdate;

  const field = 'w-full bg-slate-50 border-2 border-slate-200 rounded-2xl px-4 py-3.5 outline-none focus:border-blue-500 transition-all text-slate-800 text-sm';
  const label = 'text-xs font-semibold text-slate-500 mb-1.5 block';

  return (
    <div className="min-h-screen flex flex-col" style={{ background: 'linear-gradient(160deg, #1a56db 0%, #1e3a8a 45%, #0f172a 100%)' }}>
      {/* Шапка */}
      <div className="flex flex-col items-center pt-12 pb-6 px-6">
        <div className="w-16 h-16 rounded-[20px] mb-4 flex items-center justify-center"
          style={{ background: 'rgba(255,255,255,0.15)', border: '1px solid rgba(255,255,255,0.22)' }}>
          <svg width="36" height="32" viewBox="0 0 62 56" fill="none">
            <rect x="2" y="4" width="34" height="26" rx="9" fill="white" fillOpacity="0.95"/>
            <path d="M10 30 L4 42 L20 30 Z" fill="white" fillOpacity="0.95"/>
            <rect x="22" y="22" width="36" height="26" rx="9" fill="white" fillOpacity="0.4"/>
            <path d="M50 48 L58 58 L42 48 Z" fill="white" fillOpacity="0.4"/>
          </svg>
        </div>
        <h1 className="text-white font-bold text-xl mb-1">{t('Расскажи о себе')}</h1>
        <p className="text-blue-200 text-sm text-center">{t('Заполни профиль чтобы продолжить')}</p>
      </div>

      {/* Карточка */}
      <div className="flex-1 rounded-t-[32px] px-6 pt-6 pb-10 overflow-y-auto bg-white dark:bg-slate-900">
        {/* Аватар */}
        <div className="flex flex-col items-center mb-6">
          <button onClick={() => fileRef.current?.click()} className="relative group">
            {avatar
              ? <img src={avatar} className="w-20 h-20 rounded-full object-cover ring-4 ring-blue-100" />
              : <div className="w-20 h-20 rounded-full bg-blue-50 border-2 border-dashed border-blue-200 flex items-center justify-center">
                  <Icon name="Camera" size={26} className="text-blue-400" />
                </div>
            }
            <div className="absolute -bottom-1 -right-1 w-7 h-7 rounded-full bg-blue-600 flex items-center justify-center shadow-md">
              <Icon name="Plus" size={13} className="text-white" />
            </div>
          </button>
          <input ref={fileRef} type="file" accept="image/*" hidden onChange={pickAvatar} />
          <span className="text-xs text-slate-400 mt-2">{t('Фото (необязательно)')}</span>
        </div>

        <div className="space-y-4">
          {/* Ник */}
          <div>
            <label className={label}>{t('Ник')}</label>
            <div className="w-full bg-blue-50 border-2 border-blue-100 rounded-2xl px-4 py-3.5 text-blue-700 text-sm font-medium">
              @{user.nick}
            </div>
          </div>

          <div>
            <label className={label}>{t('Город')} <span className="text-red-400">*</span></label>
            <input value={city} onChange={e => setCity(e.target.value)} placeholder={t('Москва')} className={field} />
          </div>

          <div>
            <label className={label}>{t('Дата рождения')} <span className="text-red-400">*</span></label>
            <input type="date" value={birthdate} onChange={e => setBirthdate(e.target.value)} className={field} />
          </div>

          <div>
            <label className={label}>{t('О себе')}</label>
            <textarea value={about} onChange={e => setAbout(e.target.value)} rows={3}
              placeholder={t('Расскажи немного о себе...')}
              className={`${field} resize-none`} />
          </div>

          {!canSave && (
            <p className="text-xs text-slate-400 text-center flex items-center justify-center gap-1">
              <Icon name="Info" size={13} className="text-blue-400" />
              {t('Заполни город и дату рождения')}
            </p>
          )}

          <button onClick={save} disabled={saving || !canSave}
            className="w-full py-4 rounded-2xl font-bold text-white text-base disabled:opacity-40 transition-all active:scale-[0.98]"
            style={{ background: 'linear-gradient(135deg, #2563eb, #1d4ed8)' }}>
            {saving ? t('Сохраняю...') : t('Продолжить')}
          </button>
        </div>
      </div>
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════════════
// TABS SHELL
// ══════════════════════════════════════════════════════════════════════════════
function TabsShell({ tab, onTab, children, user }: { tab: Tab; onTab: (tabKey: Tab) => void; children: React.ReactNode; user: User }) {
  const { t } = useLang();
  const [unreadChats, setUnreadChats] = useState(0);

  useEffect(() => {
    const loadChats = () => api(`chats&user_id=${user.id}`).then(d => {
      const chats = (d.chats as Array<{ unread_count?: number }>) || [];
      const total = chats.reduce((sum, c) => sum + (Number(c.unread_count) || 0), 0);
      setUnreadChats(total);
    });
    loadChats();
    const iv = setInterval(loadChats, 15000);
    return () => clearInterval(iv);
  }, [user.id]);

  const tabs: { key: Tab; icon: string; label: string; badge?: number; emoji?: string }[] = [
    { key: 'feed', icon: 'LayoutGrid', label: t('Лента') },
    { key: 'search', icon: 'Search', label: t('Поиск') },
    { key: 'chats', icon: 'MessageCircle', label: t('Чаты'), badge: unreadChats },
    { key: 'profile', icon: 'User', label: t('Профиль') },
  ];
  return (
    <div className="flex flex-col bg-white dark:bg-slate-900" style={{ height: '100dvh', paddingTop: 'calc(env(safe-area-inset-top) + 8px)' }}>
      <div className="flex-1 overflow-hidden flex flex-col pb-[80px]" style={{ background: 'hsl(var(--background))' }}>{children}</div>
      <div className="fixed bottom-0 left-0 right-0 flex justify-center pt-2 px-4"
        style={{ background: 'linear-gradient(to top, hsl(var(--background)) 60%, transparent)', paddingBottom: 'calc(env(safe-area-inset-bottom) * 0.15 + 4px)' }}>
        <nav className="flex items-center gap-1 px-2 py-2 rounded-[28px] shadow-xl"
          style={{ background: 'hsl(var(--card) / 0.98)', backdropFilter: 'blur(24px)', boxShadow: '0 8px 32px rgba(30,58,138,0.13), 0 2px 8px rgba(30,58,138,0.08)' }}>
          {tabs.map(tb => (
            <button key={tb.key} onClick={() => onTab(tb.key)}
              className="relative flex flex-col items-center transition-all"
              style={{ minWidth: 64 }}>
              <div className={`relative flex flex-col items-center justify-center gap-0.5 px-4 py-2 rounded-[20px] transition-all duration-200
                ${tab === tb.key ? 'bg-blue-600 shadow-md shadow-blue-200' : 'hover:bg-slate-100 dark:hover:bg-slate-800'}`}>
                <Icon name={tb.icon} size={21}
                  className={tab === tb.key ? 'text-white' : 'text-slate-400 dark:text-slate-500'} />
                <span className={`text-[10px] font-semibold leading-none transition-colors
                  ${tab === tb.key ? 'text-white' : 'text-slate-400 dark:text-slate-500'}`}>
                  {tb.label}
                </span>
                {(tb.badge || 0) > 0 && (
                  <span className="absolute top-1 right-1.5 min-w-[16px] h-4 rounded-full bg-red-500 text-white text-[9px] font-bold flex items-center justify-center px-0.5 shadow-sm">
                    {tb.badge! > 99 ? '99+' : tb.badge}
                  </span>
                )}
              </div>
            </button>
          ))}
        </nav>
      </div>
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════════════
// CHATS TAB
// ══════════════════════════════════════════════════════════════════════════════
function ChatsTab({ user, onOpenChat, onNewGroup, onOpenGroup, onOpenNotifications }: { user: User; onOpenChat: (c: ChatItem) => void; onNewGroup: () => void; onOpenGroup: (gid: number, chatId: number) => void; onOpenNotifications?: () => void }) {
  const { t } = useLang();
  const [chats, setChats] = useState<ChatItem[]>([]);
  const [showMenu, setShowMenu] = useState(false);
  const [swipedId, setSwipedId] = useState<number | null>(null);
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<'all' | 'unread' | 'groups'>('all');
  const [unreadNotifs, setUnreadNotifs] = useState(0);

  const load = useCallback(async () => {
    const d = await api(`chats&user_id=${user.id}`);
    setChats(d.chats || []);
  }, [user.id]);

  useEffect(() => { load(); const iv = setInterval(load, 15000); return () => clearInterval(iv); }, [load]);

  useEffect(() => {
    const loadNotifs = () => api(`notifications&user_id=${user.id}`).then(d => {
      setUnreadNotifs(Number(d.unread) || 0);
    });
    loadNotifs();
    const iv = setInterval(loadNotifs, 20000);
    return () => clearInterval(iv);
  }, [user.id]);

  const [deleteConfirm, setDeleteConfirm] = useState<number | null>(null);

  const hideChat = async (chatId: number, forAll = false) => {
    if (forAll) {
      await api('delete_chat', 'POST', { user_id: user.id, chat_id: chatId });
    } else {
      await api('hide_chat', 'POST', { user_id: user.id, chat_id: chatId });
    }
    setChats(cs => cs.filter(c => c.chat_id !== chatId));
    setSwipedId(null);
    setDeleteConfirm(null);
  };

  const unreadCount = chats.filter(c => (c.unread_count || 0) > 0).length;
  const groupCount = chats.filter(c => c.kind === 'group').length;

  const visibleChats = chats.filter(c => {
    const name = c.kind === 'group' ? (c.group_name || '') : (c.peer_nick || '');
    if (search && !name.toLowerCase().includes(search.toLowerCase())) return false;
    if (filter === 'unread') return (c.unread_count || 0) > 0;
    if (filter === 'groups') return c.kind === 'group';
    return true;
  });

  return (
    <div className="flex flex-col h-full" onClick={() => { setShowMenu(false); setSwipedId(null); }}>
      {/* Фиксированная шапка */}
      <div className="shrink-0 bg-white dark:bg-slate-900 px-4 pt-6 pb-2 border-b border-slate-100 dark:border-slate-800" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-3 relative">
          <h1 className="text-2xl font-bold text-slate-900 dark:text-slate-100" style={{ letterSpacing: '-0.5px' }}>{t('Чаты')}</h1>
          <div className="flex items-center gap-4">
            {onOpenNotifications && (
              <button onClick={() => onOpenNotifications()}
                className="relative w-9 h-9 rounded-xl flex items-center justify-center shadow-sm transition-all active:scale-90 bell-shake"
                style={{ background: 'linear-gradient(145deg, #3b82f6, #1d4ed8)', boxShadow: '0 2px 8px rgba(37,99,235,0.4)' }}>
                <Icon name="Bell" size={17} className="text-white" />
                {unreadNotifs > 0 && (
                  <span className="absolute -top-1 -right-1 min-w-[16px] h-4 rounded-full bg-red-500 text-white text-[9px] font-bold flex items-center justify-center px-0.5 shadow-sm border-2 border-white dark:border-slate-900">
                    {unreadNotifs > 99 ? '99+' : unreadNotifs}
                  </span>
                )}
              </button>
            )}
            <div className="relative">
              <button onClick={() => setShowMenu(v => !v)}
                className="w-9 h-9 rounded-xl bg-blue-600 flex items-center justify-center shadow-sm shadow-blue-200 transition-all active:scale-95">
                <Icon name="Plus" size={18} className="text-white" />
              </button>
              {showMenu && (
                <div className="absolute right-0 top-11 bg-white dark:bg-slate-900 rounded-2xl p-1 z-50 w-52 shadow-xl border border-slate-100 dark:border-slate-800 animate-fade-up">
                  <button onClick={() => { setShowMenu(false); onNewGroup(); }}
                    className="w-full flex items-center gap-3 px-4 py-3 rounded-xl hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors text-sm text-slate-700 dark:text-slate-200 font-medium">
                    <Icon name="Users" size={16} className="text-blue-600" /> {t('Создать группу')}
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>
        {/* Поиск */}
        <div className="flex items-center gap-2 bg-slate-100 dark:bg-slate-800 rounded-2xl px-3 py-2.5 mb-3">
          <Icon name="Search" size={16} className="text-slate-400 dark:text-slate-500 shrink-0" />
          <input value={search} onChange={e => setSearch(e.target.value)}
            placeholder={t('Поиск')}
            className="flex-1 bg-transparent outline-none text-sm text-slate-700 dark:text-slate-100 placeholder:text-slate-400 dark:placeholder:text-slate-500" />
          {search && <button onClick={() => setSearch('')}><Icon name="X" size={14} className="text-slate-400 dark:text-slate-500" /></button>}
        </div>
        {/* Фильтры */}
        <div className="flex gap-2 overflow-x-auto scrollbar-none pb-1">
          {([
            { key: 'all', label: t('Все') },
            { key: 'unread', label: `${t('Непрочитанные')}${unreadCount > 0 ? ` ${unreadCount}` : ''}` },
            { key: 'groups', label: `${t('Группы')}${groupCount > 0 ? ` ${groupCount}` : ''}` },
          ] as const).map(f => (
            <button key={f.key} onClick={() => setFilter(f.key)}
              className={`shrink-0 px-4 py-1.5 rounded-full text-sm font-medium transition-colors ${filter === f.key ? 'bg-green-100 text-green-700' : 'bg-slate-100 dark:bg-slate-800 text-slate-500 dark:text-slate-400 hover:bg-slate-200 dark:hover:bg-slate-700'}`}>
              {f.label}
            </button>
          ))}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto scrollbar-thin px-3 pb-2 bg-white dark:bg-slate-950">
        {visibleChats.length === 0 && (
          <div className="flex flex-col items-center justify-center mt-24 gap-3">
            <div className="w-16 h-16 rounded-2xl bg-blue-50 dark:bg-slate-800 flex items-center justify-center">
              <Icon name="MessageCircle" size={32} className="text-blue-300" />
            </div>
            <p className="font-semibold text-slate-500 dark:text-slate-400 text-sm">{search ? t('Ничего не найдено') : t('Нет сообщений')}</p>
            <p className="text-xs text-slate-400 dark:text-slate-500">{search ? t('Попробуй другой запрос') : t('Найди людей через поиск')}</p>
          </div>
        )}
        {visibleChats.map(c => (
          <div key={c.chat_id} className="relative overflow-hidden rounded-2xl">
            {swipedId === c.chat_id && (
              <div className="absolute right-0 top-0 bottom-0 flex items-center pr-2 animate-slide-in-right">
                <button onClick={e => { e.stopPropagation(); setDeleteConfirm(c.chat_id); setSwipedId(null); }}
                  className="h-12 px-4 rounded-xl bg-red-500 text-white text-sm font-semibold flex items-center gap-1.5">
                  <Icon name="Trash2" size={15} /> {t('Удалить')}
                </button>
              </div>
            )}
            {deleteConfirm === c.chat_id && (
              <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-6"
                onClick={() => setDeleteConfirm(null)}>
                <div className="bg-white dark:bg-slate-900 rounded-3xl p-6 w-full max-w-sm space-y-3 shadow-2xl"
                  onClick={e => e.stopPropagation()}>
                  <p className="font-bold text-center text-slate-800 dark:text-slate-100 text-lg">{t('Удалить чат?')}</p>
                  <p className="text-sm text-slate-500 dark:text-slate-400 text-center">{t('Чат исчезнет только у тебя. Собеседник его не потеряет.')}</p>
                  <button onClick={() => hideChat(c.chat_id, false)}
                    className="w-full py-3.5 rounded-2xl bg-red-500 text-white text-sm font-bold mt-2">
                    {t('Удалить у меня')}
                  </button>
                  <button onClick={() => setDeleteConfirm(null)}
                    className="w-full py-3 rounded-2xl text-sm text-slate-500 dark:text-slate-400 font-medium">
                    {t('Отмена')}
                  </button>
                </div>
              </div>
            )}
            <button
              onClick={() => swipedId === c.chat_id ? setSwipedId(null) : onOpenChat(c)}
              onTouchStart={e => { (e.currentTarget as HTMLButtonElement).dataset.sx = String(e.touches[0].clientX); (e.currentTarget as HTMLButtonElement).dataset.sy = String(e.touches[0].clientY); }}
              onTouchEnd={e => {
                const sx = Number((e.currentTarget as HTMLButtonElement).dataset.sx || 0);
                const sy = Number((e.currentTarget as HTMLButtonElement).dataset.sy || 0);
                const dx = e.changedTouches[0].clientX - sx;
                const dy = Math.abs(e.changedTouches[0].clientY - sy);
                if (dx < -50 && dy < 40) { setSwipedId(c.chat_id); return; }
                if (dx > 30 && dy < 40) { setSwipedId(null); return; }
              }}
              className={`w-full flex items-center gap-3 px-2 py-3 rounded-2xl transition-all active:bg-blue-50 ${swipedId === c.chat_id ? 'translate-x-[-88px]' : 'translate-x-0'}`}>
              {c.kind === 'group'
                ? <div className="w-12 h-12 rounded-2xl shrink-0 overflow-hidden">
                    {c.group_avatar
                      ? <img src={c.group_avatar} className="w-full h-full object-cover" />
                      : <div className="w-full h-full bg-blue-600 flex items-center justify-center"><Icon name="Users" size={20} className="text-white" /></div>
                    }
                  </div>
                : <Avatar url={c.peer_avatar} nick={c.peer_nick || '?'} size={48} online={c.peer_online} />
              }
              <div className="flex-1 min-w-0 text-left">
                <div className="font-semibold text-slate-800 dark:text-slate-100 truncate text-[17px] flex items-center gap-1">
                  <span className="truncate">{c.kind === 'group' ? c.group_name : `@${c.peer_nick}`}</span>
                  {c.kind !== 'group' && c.peer_verified && <VerifiedBadge size={15} />}
                </div>
                <div className="text-[14px] text-slate-400 dark:text-slate-500 truncate mt-0.5">{c.last_text || t('Нет сообщений')}</div>
              </div>
              <div className="flex flex-col items-end gap-1.5 shrink-0 ml-1">
                <span className="text-[11px] text-slate-400 dark:text-slate-500">{fmtTime(c.last_at || null)}</span>
                <div className="flex items-center gap-1">
                  {(c.unread_count || 0) > 0 && (
                    <span className="min-w-[20px] h-5 rounded-full bg-blue-600 text-white text-[11px] font-bold flex items-center justify-center px-1.5">
                      {(c.unread_count || 0) > 99 ? '99+' : c.unread_count}
                    </span>
                  )}
                  {c.kind === 'group' && c.group_id && (
                    <button onClick={e => { e.stopPropagation(); onOpenGroup(c.group_id!, c.chat_id); }}
                      className="w-5 h-5 rounded-full hover:bg-slate-100 dark:hover:bg-slate-700 flex items-center justify-center transition-colors">
                      <Icon name="Info" size={12} className="text-blue-400" />
                    </button>
                  )}
                </div>
              </div>
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════════════
// STATUS BAR — лента статусов над списком чатов (как в WhatsApp)
// ══════════════════════════════════════════════════════════════════════════════
function StatusBar({ user, onCreateStatus, onOpenStatus }: { user: User; onCreateStatus: () => void; onOpenStatus: (userId: number) => void }) {
  const { t } = useLang();
  const [feed, setFeed] = useState<StatusFeedItem[]>([]);

  const load = useCallback(async () => {
    const d = await api(`statuses_feed&user_id=${user.id}`);
    setFeed((d.feed as StatusFeedItem[]) || []);
  }, [user.id]);

  useEffect(() => { load(); const iv = setInterval(load, 15000); return () => clearInterval(iv); }, [load]);

  const myStatus = feed.find(f => f.user_id === user.id);
  const others = feed.filter(f => f.user_id !== user.id);

  return (
    <div className="shrink-0 bg-white dark:bg-slate-900 border-b border-slate-100 dark:border-slate-800 px-3 py-3 overflow-x-auto scrollbar-none">
      <div className="flex gap-3">
        {/* Мой статус */}
        <button onClick={() => myStatus ? onOpenStatus(user.id) : onCreateStatus()} className="flex flex-col items-center gap-1 shrink-0 w-16">
          <div className="relative">
            <div className={`w-14 h-14 rounded-full p-[2px] ${myStatus ? 'bg-green-500' : 'bg-transparent'}`}>
              <div className="w-full h-full rounded-full border-2 border-white dark:border-slate-900 overflow-hidden">
                <Avatar url={user.avatar_url} nick={user.nick} size={50} />
              </div>
            </div>
            <div className="absolute -bottom-0.5 -right-0.5 w-5 h-5 rounded-full bg-blue-600 border-2 border-white dark:border-slate-900 flex items-center justify-center">
              <Icon name="Plus" size={11} className="text-white" />
            </div>
          </div>
          <span className="text-[11px] text-slate-500 dark:text-slate-400 truncate w-full text-center flex items-center gap-0.5 justify-center">
            {t('Мой статус')}{user.is_verified && <VerifiedBadge size={11} />}
          </span>
        </button>

        {others.map(f => (
          <button key={f.user_id} onClick={() => onOpenStatus(f.user_id)} className="flex flex-col items-center gap-1 shrink-0 w-16">
            <div className={`w-14 h-14 rounded-full p-[2px] ${f.unseen_count > 0 ? 'bg-green-500' : 'bg-slate-200 dark:bg-slate-700'}`}>
              <div className="w-full h-full rounded-full border-2 border-white dark:border-slate-900 overflow-hidden">
                <Avatar url={f.avatar_url} nick={f.nick} size={50} />
              </div>
            </div>
            <span className="text-[11px] text-slate-500 dark:text-slate-400 truncate w-full text-center flex items-center gap-0.5 justify-center">
              @{f.nick}{f.is_verified && <VerifiedBadge size={11} />}
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════════════
// FEED TAB — лента публикаций (фото/видео/текст) + статусы сверху + поиск
// ══════════════════════════════════════════════════════════════════════════════
function PostCard({ post, user, onOpenProfile, onChanged }: { post: Post; user: User; onOpenProfile: (id: number) => void; onChanged: (p: Post) => void }) {
  const { t } = useLang();
  const [showComments, setShowComments] = useState(false);
  const [comments, setComments] = useState<PostComment[]>([]);
  const [commentText, setCommentText] = useState('');
  const [showLikers, setShowLikers] = useState(false);
  const [likers, setLikers] = useState<User[]>([]);
  const viewedRef = useRef(false);
  const cardRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (viewedRef.current) return;
    const el = cardRef.current;
    if (!el) return;
    const obs = new IntersectionObserver((entries) => {
      if (entries[0].isIntersecting && !viewedRef.current) {
        viewedRef.current = true;
        api('post_view', 'POST', { user_id: user.id, post_id: post.id });
        obs.disconnect();
      }
    }, { threshold: 0.6 });
    obs.observe(el);
    return () => obs.disconnect();
  }, [post.id, user.id]);

  const toggleLike = async () => {
    onChanged({ ...post, liked_by_me: !post.liked_by_me, likes_count: post.likes_count + (post.liked_by_me ? -1 : 1) });
    const d = await api('post_like', 'POST', { user_id: user.id, post_id: post.id });
    if (typeof d.likes_count === 'number') onChanged({ ...post, liked_by_me: d.liked as boolean, likes_count: d.likes_count as number });
  };

  const loadComments = async () => {
    const d = await api(`post_comments&post_id=${post.id}`);
    setComments((d.comments as PostComment[]) || []);
  };

  const sendComment = async () => {
    const txt = commentText.trim();
    if (!txt) return;
    setCommentText('');
    const d = await api('post_comment_add', 'POST', { user_id: user.id, post_id: post.id, text: txt });
    if (d.comment) {
      setComments(c => [...c, d.comment as PostComment]);
      onChanged({ ...post, comments_count: post.comments_count + 1 });
    }
  };

  const loadLikers = async () => {
    const d = await api(`post_likers&post_id=${post.id}`);
    setLikers((d.users as User[]) || []);
    setShowLikers(true);
  };

  return (
    <div ref={cardRef} className="bg-white dark:bg-slate-900 rounded-3xl border border-slate-100 dark:border-slate-800 overflow-hidden animate-fade-up">
      <button onClick={() => onOpenProfile(post.user_id)} className="w-full flex items-center gap-3 px-4 py-3">
        <Avatar url={post.avatar_url} nick={post.nick} size={40} />
        <div className="flex-1 text-left min-w-0">
          <div className="font-semibold text-slate-800 dark:text-slate-100 text-sm flex items-center gap-1">@{post.nick}{post.is_verified && <VerifiedBadge size={13} />}</div>
          <div className="text-xs text-slate-400 dark:text-slate-500">{fmtTime(post.created_at)}</div>
        </div>
      </button>

      {post.type === 'text' && (
        <p className="px-4 pb-3 text-sm text-slate-700 dark:text-slate-200 whitespace-pre-wrap leading-relaxed">{post.content}</p>
      )}
      {post.type === 'photo' && (
        <img src={post.content} className="w-full max-h-[480px] object-cover" />
      )}
      {post.type === 'video' && (
        <video src={post.content} controls className="w-full max-h-[480px] object-cover bg-black" />
      )}
      {post.caption && post.type !== 'text' && (
        <p className="px-4 pt-2 text-sm text-slate-600 dark:text-slate-300">{post.caption}</p>
      )}

      <div className="flex items-center gap-4 px-4 py-3">
        <button onClick={toggleLike} className="flex items-center gap-1.5 active:scale-90 transition-transform">
          <Icon name="Heart" size={22} className={post.liked_by_me ? 'text-red-500 fill-red-500' : 'text-slate-400 dark:text-slate-500'} />
          <button onClick={(e) => { e.stopPropagation(); loadLikers(); }} className="text-sm text-slate-500 dark:text-slate-400 font-medium">{post.likes_count}</button>
        </button>
        <button onClick={() => { setShowComments(v => !v); if (!showComments) loadComments(); }} className="flex items-center gap-1.5">
          <Icon name="MessageCircle" size={20} className="text-slate-400 dark:text-slate-500" />
          <span className="text-sm text-slate-500 dark:text-slate-400 font-medium">{post.comments_count}</span>
        </button>
        <div className="flex items-center gap-1.5 ml-auto">
          <Icon name="Eye" size={18} className="text-slate-300 dark:text-slate-600" />
          <span className="text-xs text-slate-400 dark:text-slate-500">{post.views_count}</span>
        </div>
      </div>

      {showComments && (
        <div className="px-4 pb-4 border-t border-slate-50 dark:border-slate-800 pt-3 space-y-3">
          {comments.map(c => (
            <div key={c.id} className="flex items-start gap-2">
              <Avatar url={c.avatar_url} nick={c.nick} size={28} />
              <div className="flex-1 bg-slate-50 dark:bg-slate-800 rounded-2xl px-3 py-2">
                <div className="text-xs font-semibold text-slate-700 dark:text-slate-200 flex items-center gap-1">
                  @{c.nick}{c.reply_to_nick && <span className="text-slate-400 font-normal">→ @{c.reply_to_nick}</span>}
                </div>
                <div className="text-sm text-slate-600 dark:text-slate-300">{c.text}</div>
              </div>
            </div>
          ))}
          <div className="flex items-center gap-2">
            <input value={commentText} onChange={e => setCommentText(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && sendComment()}
              placeholder={t('Комментарий...')}
              className="flex-1 bg-slate-50 dark:bg-slate-800 rounded-full px-4 py-2 outline-none text-sm text-slate-800 dark:text-slate-100 placeholder:text-slate-400" />
            <button onClick={sendComment} disabled={!commentText.trim()} className="w-9 h-9 shrink-0 rounded-full bg-blue-600 flex items-center justify-center disabled:opacity-40">
              <Icon name="Send" size={15} className="text-white" />
            </button>
          </div>
        </div>
      )}

      {showLikers && (
        <div className="fixed inset-0 z-50 bg-black/40 flex items-end" onClick={() => setShowLikers(false)}>
          <div className="bg-white dark:bg-slate-900 rounded-t-3xl w-full max-h-[60vh] overflow-y-auto p-5" onClick={e => e.stopPropagation()}>
            <h3 className="font-bold text-slate-800 dark:text-slate-100 mb-4">{t('Понравилось')}</h3>
            {likers.map(u => (
              <button key={u.id} onClick={() => onOpenProfile(u.id)} className="w-full flex items-center gap-3 py-2">
                <Avatar url={u.avatar_url} nick={u.nick} size={40} />
                <span className="font-medium text-slate-800 dark:text-slate-100">@{u.nick}</span>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function FeedTab({ user, onOpenProfile, onCreateStatus, onOpenStatus }: { user: User; onOpenProfile: (id: number) => void; onCreateStatus: () => void; onOpenStatus: (userId: number) => void }) {
  const { t } = useLang();
  const [posts, setPosts] = useState<Post[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [showSearch, setShowSearch] = useState(false);
  const [q, setQ] = useState('');
  const [searchResults, setSearchResults] = useState<Post[]>([]);

  const load = useCallback(async () => {
    const d = await api(`feed&user_id=${user.id}`);
    setPosts((d.posts as Post[]) || []);
    setLoading(false);
  }, [user.id]);

  useEffect(() => { load(); const iv = setInterval(load, 20000); return () => clearInterval(iv); }, [load]);

  useEffect(() => {
    if (!q.trim()) { setSearchResults([]); return; }
    const tm = setTimeout(async () => {
      const d = await api(`post_search&user_id=${user.id}&q=${encodeURIComponent(q.trim())}`);
      setSearchResults((d.posts as Post[]) || []);
    }, 300);
    return () => clearTimeout(tm);
  }, [q, user.id]);

  const updatePost = (p: Post) => setPosts(ps => ps.map(x => x.id === p.id ? p : x));

  return (
    <div className="flex flex-col h-full">
      <div className="shrink-0 px-4 pt-4 pb-2 bg-white dark:bg-slate-900 border-b border-slate-100 dark:border-slate-800 flex items-center justify-between">
        <h1 className="text-2xl font-bold text-slate-900 dark:text-slate-100" style={{ letterSpacing: '-0.5px' }}>{t('Лента')}</h1>
        <div className="flex items-center gap-2">
          <button onClick={() => setShowSearch(v => !v)} className="w-9 h-9 rounded-xl bg-slate-100 dark:bg-slate-800 flex items-center justify-center">
            <Icon name="Search" size={17} className="text-slate-500 dark:text-slate-300" />
          </button>
          <button onClick={() => setShowCreate(true)} className="w-9 h-9 rounded-xl bg-blue-600 flex items-center justify-center shadow-sm shadow-blue-200">
            <Icon name="Plus" size={18} className="text-white" />
          </button>
        </div>
      </div>

      {showSearch && (
        <div className="shrink-0 px-4 py-2 bg-white dark:bg-slate-900 border-b border-slate-100 dark:border-slate-800">
          <div className="flex items-center gap-2 bg-slate-100 dark:bg-slate-800 rounded-2xl px-3 py-2.5">
            <Icon name="Search" size={16} className="text-slate-400 shrink-0" />
            <input autoFocus value={q} onChange={e => setQ(e.target.value)} placeholder={t('Найти публикацию по нику…')}
              className="flex-1 bg-transparent outline-none text-sm text-slate-700 dark:text-slate-100 placeholder:text-slate-400" />
            {q && <button onClick={() => setQ('')}><Icon name="X" size={14} className="text-slate-400" /></button>}
          </div>
        </div>
      )}

      <div className="flex-1 overflow-y-auto scrollbar-thin bg-slate-50 dark:bg-slate-950">
        {!showSearch && <StatusBar user={user} onCreateStatus={onCreateStatus} onOpenStatus={onOpenStatus} />}

        <div className="p-3 space-y-3">
          {q.trim() ? (
            searchResults.length === 0
              ? <p className="text-center text-slate-400 mt-12 text-sm">{t('Ничего не найдено')}</p>
              : searchResults.map(p => <PostCard key={p.id} post={p} user={user} onOpenProfile={onOpenProfile} onChanged={() => {}} />)
          ) : loading ? (
            <div className="flex justify-center pt-12"><div className="w-8 h-8 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" /></div>
          ) : posts.length === 0 ? (
            <div className="flex flex-col items-center justify-center mt-16 gap-3">
              <div className="w-16 h-16 rounded-2xl bg-blue-50 dark:bg-slate-800 flex items-center justify-center">
                <Icon name="Image" size={32} className="text-blue-300" />
              </div>
              <p className="font-semibold text-slate-500 dark:text-slate-400 text-sm">{t('Пока нет публикаций')}</p>
              <p className="text-xs text-slate-400 dark:text-slate-500">{t('Опубликуй первое фото, видео или текст')}</p>
            </div>
          ) : (
            posts.map(p => <PostCard key={p.id} post={p} user={user} onOpenProfile={onOpenProfile} onChanged={updatePost} />)
          )}
        </div>
      </div>

      {showCreate && <PostCreateModal user={user} onClose={() => setShowCreate(false)} onCreated={() => { setShowCreate(false); load(); }} />}
    </div>
  );
}

function PostCreateModal({ user, onClose, onCreated }: { user: User; onClose: () => void; onCreated: () => void }) {
  const { t } = useLang();
  const [type, setType] = useState<'text' | 'photo' | 'video'>('text');
  const [text, setText] = useState('');
  const [caption, setCaption] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState('');
  const [posting, setPosting] = useState(false);
  const [error, setError] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);

  const pickFile = (kind: 'photo' | 'video') => {
    setType(kind);
    fileRef.current?.click();
  };

  const onFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0]; e.target.value = '';
    if (!f) return;
    setFile(f);
    setPreview(URL.createObjectURL(f));
  };

  const canPost = type === 'text' ? text.trim().length > 0 : !!file;

  const post = async () => {
    if (!canPost || posting) return;
    setPosting(true); setError('');
    try {
      if (type === 'text') {
        const d = await api('post_create', 'POST', { user_id: user.id, type: 'text', content: text.trim() });
        if (d.error) { setError(d.error as string); return; }
      } else {
        const compressed = type === 'photo' ? await compressImage(file!, 1600, 0.85) : null;
        let b64: string, ext: string;
        if (compressed) {
          [, b64] = compressed.split(',');
          ext = 'jpg';
        } else {
          ext = (file!.name.split('.').pop() || 'mp4').toLowerCase();
          b64 = await new Promise<string>((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => resolve((reader.result as string).split(',')[1]);
            reader.onerror = reject;
            reader.readAsDataURL(file!);
          });
        }
        const up = await api('upload_post_media', 'POST', { user_id: user.id, data: b64, ext, media_type: type });
        if (up.error || !up.url) { setError((up.error as string) || t('Ошибка загрузки')); return; }
        const d = await api('post_create', 'POST', { user_id: user.id, type, content: up.url, caption: caption.trim() || undefined });
        if (d.error) { setError(d.error as string); return; }
      }
      onCreated();
    } finally {
      setPosting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-white dark:bg-slate-950 flex flex-col" style={{ paddingTop: 'env(safe-area-inset-top)' }}>
      <div className="shrink-0 flex items-center justify-between px-4 py-3 border-b border-slate-100 dark:border-slate-800">
        <button onClick={onClose} className="w-9 h-9 rounded-full hover:bg-slate-100 dark:hover:bg-slate-800 flex items-center justify-center">
          <Icon name="X" size={20} className="text-slate-600 dark:text-slate-300" />
        </button>
        <h1 className="font-bold text-slate-800 dark:text-slate-100">{t('Новая публикация')}</h1>
        <button onClick={post} disabled={!canPost || posting}
          className="px-4 py-1.5 rounded-full bg-blue-600 text-white text-sm font-semibold disabled:opacity-40">
          {posting ? t('Публикация...') : t('Опубликовать')}
        </button>
      </div>
      <div className="flex-1 overflow-y-auto p-4">
        <input ref={fileRef} type="file" accept={type === 'video' ? 'video/*' : 'image/*'} hidden onChange={onFile} />
        <div className="flex gap-2 mb-4">
          {([
            { key: 'text', icon: 'Type', label: t('Текст') },
            { key: 'photo', icon: 'Image', label: t('Фото') },
            { key: 'video', icon: 'Video', label: t('Видео') },
          ] as const).map(opt => (
            <button key={opt.key} onClick={() => opt.key === 'text' ? setType('text') : pickFile(opt.key)}
              className={`flex-1 py-3 rounded-2xl flex flex-col items-center gap-1 border transition-colors ${type === opt.key ? 'bg-blue-50 dark:bg-blue-950/40 border-blue-200 dark:border-blue-900' : 'bg-slate-50 dark:bg-slate-900 border-slate-100 dark:border-slate-800'}`}>
              <Icon name={opt.icon} size={20} className={type === opt.key ? 'text-blue-600' : 'text-slate-400'} />
              <span className={`text-xs font-medium ${type === opt.key ? 'text-blue-600' : 'text-slate-500 dark:text-slate-400'}`}>{opt.label}</span>
            </button>
          ))}
        </div>

        {type === 'text' && (
          <textarea value={text} onChange={e => setText(e.target.value.slice(0, 2000))} autoFocus rows={8}
            placeholder={t('Что у вас нового?')}
            className="w-full bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-2xl p-4 outline-none focus:ring-2 focus:ring-blue-500 resize-none text-slate-800 dark:text-slate-100 text-sm" />
        )}

        {(type === 'photo' || type === 'video') && (
          <>
            {preview ? (
              <div className="relative rounded-3xl overflow-hidden mb-4 bg-black">
                {type === 'photo' ? <img src={preview} className="w-full max-h-[400px] object-contain" /> : <video src={preview} controls className="w-full max-h-[400px]" />}
                <button onClick={() => { setFile(null); setPreview(''); }} className="absolute top-2 right-2 w-8 h-8 rounded-full bg-black/60 flex items-center justify-center">
                  <Icon name="X" size={16} className="text-white" />
                </button>
              </div>
            ) : (
              <button onClick={() => pickFile(type)} className="w-full aspect-square rounded-3xl border-2 border-dashed border-slate-200 dark:border-slate-700 flex flex-col items-center justify-center gap-2 text-slate-400 dark:text-slate-500 mb-4">
                <Icon name={type === 'photo' ? 'Image' : 'Video'} size={32} />
                <span className="text-sm font-medium">{t('Выбрать файл')}</span>
              </button>
            )}
            {preview && (
              <input value={caption} onChange={e => setCaption(e.target.value)} placeholder={t('Добавить подпись...')}
                className="w-full bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-2xl px-4 py-3 outline-none focus:ring-2 focus:ring-blue-500 text-slate-800 dark:text-slate-100 text-sm" />
            )}
          </>
        )}

        {error && <p className="text-red-500 text-sm mt-3">{error}</p>}
      </div>
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════════════
// SEARCH TAB
// ══════════════════════════════════════════════════════════════════════════════
function SearchTab({ user, onOpenProfile }: { user: User; onOpenProfile: (id: number) => void }) {
  const { t } = useLang();
  const [q, setQ] = useState('');
  const [results, setResults] = useState<(User & { city?: string; is_online?: boolean })[]>([]);

  useEffect(() => {
    if (!q.trim()) { setResults([]); return; }
    const tm = setTimeout(async () => {
      const d = await api(`search&q=${encodeURIComponent(q.trim())}&user_id=${user.id}`);
      setResults(d.users || []);
    }, 250);
    return () => clearTimeout(tm);
  }, [q, user.id]);

  return (
    <div className="flex flex-col h-full">
      <div className="shrink-0 px-4 pt-4 pb-3 bg-white dark:bg-slate-900 border-b border-slate-100 dark:border-slate-800">
        <h1 className="text-2xl font-bold text-slate-900 dark:text-slate-100 mb-3" style={{ letterSpacing: '-0.5px' }}>{t('Поиск')}</h1>
        <div className="flex items-center gap-2 bg-slate-100 dark:bg-slate-800 rounded-2xl px-3 py-2.5">
          <Icon name="Search" size={16} className="text-slate-400 dark:text-slate-500 shrink-0" />
          <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder={t('Найти по нику…')}
            className="flex-1 bg-transparent outline-none text-sm text-slate-700 dark:text-slate-100 placeholder:text-slate-400 dark:placeholder:text-slate-500" />
          {q && <button onClick={() => setQ('')}><Icon name="X" size={14} className="text-slate-400 dark:text-slate-500" /></button>}
        </div>
      </div>
      <div className="flex-1 overflow-y-auto scrollbar-thin px-3 pb-2 bg-white dark:bg-slate-950">
        {q.trim() && results.length === 0 && <p className="text-center text-slate-400 dark:text-slate-500 mt-12 text-sm">{t('Никого не найдено')}</p>}
        {results.map(u => (
          <button key={u.id} onClick={() => onOpenProfile(u.id)} className="w-full flex items-center gap-3 px-2 py-3 rounded-2xl hover:bg-blue-50 dark:hover:bg-slate-800 transition-colors animate-fade-up">
            <Avatar url={u.avatar_url} nick={u.nick} size={48} online={u.is_online} />
            <div className="flex-1 text-left">
              <div className="font-semibold text-slate-800 dark:text-slate-100 flex items-center gap-1">@{u.nick}{u.is_verified && <VerifiedBadge size={14} />}</div>
              {u.city && <div className="text-xs text-slate-400 dark:text-slate-500">{u.city}</div>}
            </div>
            <Icon name="ChevronRight" size={18} className="text-slate-300 dark:text-slate-600" />
          </button>
        ))}
      </div>
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════════════
// NOTIFICATIONS TAB
// ══════════════════════════════════════════════════════════════════════════════
const NOTIF_LABELS: Record<string, string> = {
  missed_call: 'Пропущенный звонок',
  new_message: 'Новое сообщение',
  follow: 'Подписался на тебя',
  group_invite: 'Добавлен в группу',
};
const NOTIF_ICONS: Record<string, string> = {
  missed_call: 'PhoneMissed',
  new_message: 'MessageCircle',
  follow: 'UserPlus',
  group_invite: 'Users',
};

function NotificationsTab({ user, onOpenChat, onOpenProfile, onCall, onBack }: {
  user: User;
  onOpenChat: (chatId: number) => void;
  onOpenProfile: (id: number) => void;
  onCall: (peerId: number, peerNick: string, peerAvatar: string | null | undefined, kind: 'audio' | 'video') => void;
  onBack?: () => void;
}) {
  const { t } = useLang();
  const [notifs, setNotifs] = useState<Notif[]>([]);
  const [loading, setLoading] = useState(true);

  const clearedKey = `notif_cleared_${user.id}`;

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      const afterTs = localStorage.getItem(clearedKey) || '1970-01-01';
      const d = await api(`notifications&user_id=${user.id}&after_ts=${encodeURIComponent(afterTs)}`);
      if (cancelled) return;
      setNotifs((d.notifications as Notif[]) || []);
      setLoading(false);
      if ((d.notifications as Notif[] | undefined)?.length) {
        api('notifications_read', 'POST', { user_id: user.id });
      }
    };
    load();
    const tm = setTimeout(() => { if (!cancelled) setLoading(false); }, 5000);
    return () => { cancelled = true; clearTimeout(tm); };
  }, [user.id]);

  const clearAll = async () => {
    await api('clear_notifications', 'POST', { user_id: user.id });
    localStorage.setItem(clearedKey, new Date().toISOString());
    setNotifs([]);
  };

  const [tab, setTab] = useState<'notifs' | 'calls'>('notifs');
  const [calls, setCalls] = useState<{call_id:string;kind:string;status:string;created_at:string;caller_id:number;callee_id:number;caller_nick:string;caller_avatar:string|null;callee_nick:string;callee_avatar:string|null}[]>([]);
  const [callsLoading, setCallsLoading] = useState(false);

  const callsClearedKey = `calls_cleared_${user.id}`;

  const loadCalls = async () => {
    setCallsLoading(true);
    const afterTs = localStorage.getItem(callsClearedKey) || '1970-01-01';
    const d = await api(`call_history&user_id=${user.id}&after_ts=${encodeURIComponent(afterTs)}`);
    setCalls(d.calls || []);
    setCallsLoading(false);
  };

  const clearCalls = () => {
    localStorage.setItem(callsClearedKey, new Date().toISOString());
    setCalls([]);
  };

  return (
    <div className="flex flex-col h-full">
      {/* Заголовок + вкладки */}
      <div className="shrink-0 px-4 pt-6 pb-0 bg-white dark:bg-slate-900 border-b border-slate-100 dark:border-slate-800">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            {onBack && (
              <button onClick={onBack} className="w-9 h-9 -ml-1 rounded-xl flex items-center justify-center hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors">
                <Icon name="ArrowLeft" size={20} className="text-slate-500 dark:text-slate-400" />
              </button>
            )}
            <h1 className="text-2xl font-bold text-slate-900 dark:text-slate-100" style={{ letterSpacing: '-0.5px' }}>{t('Уведомления')}</h1>
          </div>
          {tab === 'notifs' && notifs.length > 0 && (
            <button onClick={clearAll} className="text-sm text-slate-400 dark:text-slate-500 hover:text-red-400 transition-colors font-medium flex items-center gap-1">
              <Icon name="Trash2" size={15} /> {t('Очистить')}
            </button>
          )}
          {tab === 'calls' && calls.length > 0 && (
            <button onClick={clearCalls} className="text-sm text-slate-400 dark:text-slate-500 hover:text-red-400 transition-colors font-medium flex items-center gap-1">
              <Icon name="Trash2" size={15} /> {t('Очистить')}
            </button>
          )}
        </div>
        <div className="flex gap-1 mb-0">
          <button onClick={() => setTab('notifs')}
            className={`flex-1 py-2 text-sm font-semibold rounded-t-xl transition-colors ${tab === 'notifs' ? 'text-blue-600 border-b-2 border-blue-600' : 'text-slate-400 dark:text-slate-500'}`}>
            {t('Уведомления')}
          </button>
          <button onClick={() => { setTab('calls'); if (!calls.length) loadCalls(); }}
            className={`flex-1 py-2 text-sm font-semibold rounded-t-xl transition-colors ${tab === 'calls' ? 'text-blue-600 border-b-2 border-blue-600' : 'text-slate-400 dark:text-slate-500'}`}>
            {t('Звонки')}
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto scrollbar-thin px-3 pb-2 pt-2 bg-white dark:bg-slate-950">
        {/* Вкладка уведомлений */}
        {tab === 'notifs' && <>
          {loading && <div className="flex justify-center mt-16"><div className="w-7 h-7 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" /></div>}
          {!loading && notifs.length === 0 && (
            <div className="flex flex-col items-center justify-center mt-24 gap-3">
              <div className="w-16 h-16 rounded-2xl bg-blue-50 dark:bg-slate-800 flex items-center justify-center"><Icon name="Bell" size={30} className="text-blue-300" /></div>
              <p className="font-semibold text-slate-500 dark:text-slate-400 text-sm">{t('Нет уведомлений')}</p>
            </div>
          )}
          {notifs.map(n => (
            <div key={n.id} className={`flex items-start gap-3 px-3 py-3.5 rounded-2xl mb-2 transition-colors ${!n.is_read ? 'bg-blue-50 dark:bg-blue-950/40 border border-blue-100 dark:border-blue-900' : 'bg-white dark:bg-slate-900 border border-slate-100 dark:border-slate-800'}`}>
              <div className="relative shrink-0">
                <div className="w-12 h-12 rounded-2xl overflow-hidden bg-slate-100 dark:bg-slate-800 flex items-center justify-center">
                  {n.from_avatar ? <img src={n.from_avatar} className="w-full h-full object-cover" /> : <span className="text-xl font-bold text-slate-400 dark:text-slate-500">{(n.from_nick || '?')[0].toUpperCase()}</span>}
                </div>
                <div className={`absolute -bottom-1 -right-1 w-5 h-5 rounded-full flex items-center justify-center ${n.type === 'missed_call' ? 'bg-red-500' : n.type === 'follow' ? 'bg-green-500' : 'bg-blue-500'}`}>
                  <Icon name={NOTIF_ICONS[n.type] || 'Bell'} size={11} className="text-white" />
                </div>
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-start justify-between gap-1">
                  <div>
                    {n.from_nick && <div className="text-sm font-bold text-slate-800 dark:text-slate-100">@{n.from_nick}</div>}
                    <div className={`text-xs font-medium mt-0.5 ${n.type === 'missed_call' ? 'text-red-500' : n.type === 'follow' ? 'text-green-600' : 'text-blue-600'}`}>{NOTIF_LABELS[n.type] ? t(NOTIF_LABELS[n.type]) : n.type}</div>
                  </div>
                  <div className="flex items-center gap-1.5 shrink-0">
                    <span className="text-[11px] text-slate-400 dark:text-slate-500">{fmtTime(n.created_at)}</span>
                    {!n.is_read && <span className="w-2 h-2 rounded-full bg-blue-500 shrink-0" />}
                  </div>
                </div>
                <div className="flex gap-2 mt-2 flex-wrap">
                  {n.type === 'missed_call' && n.from_user_id && (<>
                    <button onClick={() => onCall(n.from_user_id!, n.from_nick || '?', n.from_avatar, 'audio')} className="text-xs bg-green-500 text-white rounded-xl px-3 py-1.5 font-semibold flex items-center gap-1"><Icon name="Phone" size={12} /> {t('Перезвонить')}</button>
                    <button onClick={() => onCall(n.from_user_id!, n.from_nick || '?', n.from_avatar, 'video')} className="text-xs bg-blue-500 text-white rounded-xl px-3 py-1.5 font-semibold flex items-center gap-1"><Icon name="Video" size={12} /> {t('Видео')}</button>
                    <button onClick={() => onOpenProfile(n.from_user_id!)} className="text-xs bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 rounded-xl px-3 py-1.5 font-medium flex items-center gap-1"><Icon name="User" size={12} /> {t('Профиль')}</button>
                  </>)}
                  {n.type === 'follow' && n.from_user_id && <button onClick={() => onOpenProfile(n.from_user_id!)} className="text-xs bg-blue-600 text-white rounded-xl px-3 py-1.5 font-semibold flex items-center gap-1"><Icon name="UserPlus" size={12} /> {t('Профиль')}</button>}
                  {(n.type === 'new_message' || n.type === 'group_invite') && n.chat_id && <button onClick={() => onOpenChat(n.chat_id!)} className="text-xs bg-blue-600 text-white rounded-xl px-3 py-1.5 font-semibold flex items-center gap-1"><Icon name="MessageCircle" size={12} /> {t('Открыть чат')}</button>}
                </div>
              </div>
            </div>
          ))}
        </>}

        {/* Вкладка звонков */}
        {tab === 'calls' && <>
          {callsLoading && <div className="flex justify-center mt-16"><div className="w-7 h-7 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" /></div>}
          {!callsLoading && calls.length === 0 && (
            <div className="flex flex-col items-center justify-center mt-24 gap-3">
              <div className="w-16 h-16 rounded-2xl bg-slate-50 dark:bg-slate-800 flex items-center justify-center"><Icon name="Phone" size={30} className="text-slate-300" /></div>
              <p className="font-semibold text-slate-500 dark:text-slate-400 text-sm">{t('Нет звонков')}</p>
            </div>
          )}
          {calls.map(c => {
            const isOutgoing = c.caller_id === user.id;
            const peerNick = isOutgoing ? c.callee_nick : c.caller_nick;
            const peerAvatar = isOutgoing ? c.callee_avatar : c.caller_avatar;
            const peerId = isOutgoing ? c.callee_id : c.caller_id;
            const missed = !isOutgoing && c.status !== 'active' && c.status !== 'ended';
            return (
              <div key={c.call_id} className="flex items-center gap-3 px-3 py-3.5 bg-white dark:bg-slate-900 rounded-2xl mb-2 border border-slate-100 dark:border-slate-800">
                <div className="w-12 h-12 rounded-2xl overflow-hidden bg-slate-100 dark:bg-slate-800 flex items-center justify-center shrink-0">
                  {peerAvatar ? <img src={peerAvatar} className="w-full h-full object-cover" /> : <span className="text-xl font-bold text-slate-400 dark:text-slate-500">{(peerNick || '?')[0].toUpperCase()}</span>}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="font-bold text-slate-800 dark:text-slate-100 text-sm">@{peerNick}</div>
                  <div className={`text-xs flex items-center gap-1 mt-0.5 ${missed ? 'text-red-500' : isOutgoing ? 'text-blue-500' : 'text-green-600'}`}>
                    <Icon name={isOutgoing ? 'PhoneOutgoing' : missed ? 'PhoneMissed' : 'PhoneIncoming'} size={11} />
                    {isOutgoing ? t('Исходящий') : missed ? t('Пропущенный') : t('Входящий')} · {c.kind === 'video' ? t('видео') : t('аудио')}
                  </div>
                  <div className="text-[11px] text-slate-400 dark:text-slate-500 mt-0.5">{fmtTime(c.created_at)}</div>
                </div>
                <div className="flex gap-1.5 shrink-0">
                  <button onClick={() => onCall(peerId, peerNick, peerAvatar, 'audio')} className="w-9 h-9 rounded-full bg-green-50 flex items-center justify-center"><Icon name="Phone" size={16} className="text-green-500" /></button>
                  <button onClick={() => onCall(peerId, peerNick, peerAvatar, 'video')} className="w-9 h-9 rounded-full bg-blue-50 flex items-center justify-center"><Icon name="Video" size={16} className="text-blue-500" /></button>
                </div>
              </div>
            );
          })}
        </>}
      </div>
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════════════
// USER PROFILE SCREEN (чужой)
// ══════════════════════════════════════════════════════════════════════════════
function UserProfileScreen({ me, userId, onBack, onOpenChat, onFollowers, onCall }: { me: User; userId: number; onBack: () => void; onOpenChat: (id: number) => void; onFollowers: (uid: number, mode: 'followers' | 'following') => void; onCall?: (peer: User, kind: 'audio' | 'video') => void }) {
  const { t } = useLang();
  const [profile, setProfile] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(true);
  const [showPhoto, setShowPhoto] = useState(false);

  const load = async () => {
    const d = await api(`profile&user_id=${userId}&me=${me.id}`);
    setProfile(d.user); setLoading(false);
  };
  useEffect(() => { load(); }, [userId]);

  const follow = async () => { await api('follow', 'POST', { user_id: me.id, target_id: userId }); load(); };
  const unfollow = async () => { await api('unfollow', 'POST', { user_id: me.id, target_id: userId }); load(); };
  const block = async () => { await api('block', 'POST', { user_id: me.id, target_id: userId }); load(); };
  const unblock = async () => { await api('unblock', 'POST', { user_id: me.id, target_id: userId }); load(); };

  return (
    <div className="fixed inset-0 flex flex-col" style={{ background: 'hsl(var(--background))' }}>
      <header className="flex items-center gap-3 px-4 bg-blue-600 shrink-0"
        style={{ paddingTop: 'calc(env(safe-area-inset-top) + 6px)', paddingBottom: '12px', borderRadius: '0 0 18px 18px', boxShadow: '0 4px 20px rgba(37,99,235,0.35)', zIndex: 10 }}>
        <button onClick={onBack} className="w-9 h-9 rounded-full hover:bg-white/15 flex items-center justify-center transition-colors">
          <Icon name="ArrowLeft" size={20} className="text-white" />
        </button>
        <span className="font-bold text-white flex-1 flex items-center gap-1">{profile ? `@${profile.nick}` : '...'}{profile?.is_verified && <VerifiedBadge size={15} />}</span>
      </header>
      {loading && <div className="flex-1 flex items-center justify-center"><div className="w-8 h-8 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" /></div>}
      {profile && (
        <div className="flex-1 overflow-y-auto scrollbar-thin">
          <div className="flex flex-col items-center pt-8 pb-4 px-6">
            <button onClick={() => profile.avatar_url && setShowPhoto(true)}>
              <Avatar url={profile.avatar_url} nick={profile.nick} size={96} online={profile.is_online} />
            </button>
            {showPhoto && profile.avatar_url && (
              <MediaViewer src={profile.avatar_url} type="image" onClose={() => setShowPhoto(false)} />
            )}
            <h2 className="font-bold text-2xl mt-4 text-slate-800 dark:text-slate-100 flex items-center gap-1.5">@{profile.nick}{profile.is_verified && <VerifiedBadge size={19} />}</h2>
            <p className="text-sm text-slate-400 dark:text-slate-500 mt-1">
              {profile.is_online ? <span className="text-green-500 font-medium">{t('в сети')}</span> : fmtLastSeen(profile.last_seen || null)}
            </p>
            <div className="flex gap-8 mt-5">
              <button onClick={() => onFollowers(userId, 'followers')} className="flex flex-col items-center hover:text-blue-600 transition-colors">
                <span className="font-bold text-xl text-slate-800 dark:text-slate-100">{profile.followers}</span>
                <span className="text-xs text-slate-400 dark:text-slate-500">{t('подписчиков')}</span>
              </button>
              <button onClick={() => onFollowers(userId, 'following')} className="flex flex-col items-center hover:text-blue-600 transition-colors">
                <span className="font-bold text-xl text-slate-800 dark:text-slate-100">{profile.following}</span>
                <span className="text-xs text-slate-400 dark:text-slate-500">{t('подписок')}</span>
              </button>
            </div>
          </div>
          <div className="px-4 space-y-2 mb-4 bg-white dark:bg-slate-900 rounded-2xl mx-4 p-4 border border-slate-100 dark:border-slate-800">
            {profile.city && <div className="flex items-center gap-2 text-sm text-slate-700 dark:text-slate-200"><Icon name="MapPin" size={16} className="text-blue-500" />{profile.city}</div>}
            {profile.birthdate && <div className="flex items-center gap-2 text-sm text-slate-700 dark:text-slate-200"><Icon name="Cake" size={16} className="text-blue-500" />{new Date(profile.birthdate).toLocaleDateString('ru-RU')}</div>}
            {profile.about && <p className="text-sm mt-2 leading-relaxed text-slate-500 dark:text-slate-400">{profile.about}</p>}
          </div>
          <div className="px-4 space-y-3 pb-8 mt-2">
            {!profile.i_blocked ? (
              <>
                <button onClick={() => onOpenChat(userId)}
                  className="w-full py-3.5 rounded-2xl font-bold text-white text-sm transition-all active:scale-[0.98]"
                  style={{ background: 'linear-gradient(135deg, #2563eb, #1d4ed8)' }}>
                  <Icon name="MessageCircle" size={17} className="inline mr-2" />{t('Написать')}
                </button>
                <div className="flex gap-2">
                  <button onClick={() => onCall?.({ id: userId, nick: profile.nick, avatar_url: profile.avatar_url }, 'audio')}
                    className="flex-1 py-3 rounded-2xl font-semibold bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors text-sm">
                    <Icon name="Phone" size={17} className="inline mr-2 text-blue-500" />{t('Аудио')}
                  </button>
                  <button onClick={() => onCall?.({ id: userId, nick: profile.nick, avatar_url: profile.avatar_url }, 'video')}
                    className="flex-1 py-3 rounded-2xl font-semibold bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors text-sm">
                    <Icon name="Video" size={17} className="inline mr-2 text-blue-500" />{t('Видео')}
                  </button>
                </div>
                {profile.i_follow
                  ? <button onClick={unfollow} className="w-full py-3.5 rounded-2xl font-semibold bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors text-sm">
                      <Icon name="UserCheck" size={17} className="inline mr-2 text-green-500" />{t('Отписаться')}
                    </button>
                  : <button onClick={follow} className="w-full py-3.5 rounded-2xl font-semibold bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors text-sm">
                      <Icon name="UserPlus" size={17} className="inline mr-2 text-blue-500" />{t('Подписаться')}
                    </button>
                }
                <button onClick={block} className="w-full py-3 rounded-2xl text-red-500 text-sm hover:bg-red-50 dark:hover:bg-red-950/30 transition-colors">
                  <Icon name="Ban" size={15} className="inline mr-2" />{t('Заблокировать')}
                </button>
              </>
            ) : (
              <button onClick={unblock} className="w-full py-3.5 rounded-2xl font-semibold bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors text-red-500">
                <Icon name="Ban" size={18} className="inline mr-2" />{t('Разблокировать')}
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════════════
// FOLLOWERS LIST
// ══════════════════════════════════════════════════════════════════════════════
function FollowersScreen({ userId, mode, me, onBack, onOpenProfile }: { userId: number; mode: 'followers' | 'following'; me: User; onBack: () => void; onOpenProfile: (id: number) => void }) {
  const { t } = useLang();
  const [list, setList] = useState<User[]>([]);
  useEffect(() => {
    api(`${mode}&user_id=${userId}`).then(d => setList(d.users || []));
  }, [userId, mode]);
  return (
    <div className="fixed inset-0 flex flex-col" style={{ background: 'hsl(var(--background))' }}>
      <header className="flex items-center gap-3 px-4 bg-blue-600 shrink-0"
        style={{ paddingTop: 'calc(env(safe-area-inset-top) + 6px)', paddingBottom: '12px', borderRadius: '0 0 18px 18px', boxShadow: '0 4px 20px rgba(37,99,235,0.35)', zIndex: 10 }}>
        <button onClick={onBack} className="w-9 h-9 rounded-full hover:bg-white/15 flex items-center justify-center transition-colors">
          <Icon name="ArrowLeft" size={20} className="text-white" />
        </button>
        <span className="font-bold text-white">{mode === 'followers' ? t('Подписчики') : t('Подписки')}</span>
      </header>
      <div className="flex-1 overflow-y-auto scrollbar-thin px-3 pt-3">
        {list.length === 0 && <p className="text-center text-slate-400 dark:text-slate-500 mt-12 text-sm">{t('Пусто')}</p>}
        {list.map(u => (
          <button key={u.id} onClick={() => onOpenProfile(u.id)}
            className="w-full flex items-center gap-3 px-2 py-3 rounded-2xl hover:bg-blue-50 dark:hover:bg-slate-800 transition-colors">
            <Avatar url={u.avatar_url} nick={u.nick} size={44} online={u.is_online} />
            <span className="font-semibold flex-1 text-left text-slate-800 dark:text-slate-100 flex items-center gap-1">@{u.nick}{u.is_verified && <VerifiedBadge size={14} />}</span>
            <Icon name="ChevronRight" size={18} className="text-slate-300 dark:text-slate-600" />
          </button>
        ))}
      </div>
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════════════
// MY PROFILE TAB
// ══════════════════════════════════════════════════════════════════════════════
function ProfileTab({ user, onLogout, onUpdate, onFollowers, lightTheme, onToggleTheme, onDeleteAccount }: {
  user: User; onLogout: () => void; onUpdate: (u: User) => void;
  onFollowers: (uid: number, mode: 'followers' | 'following') => void;
  lightTheme: boolean;
  onToggleTheme: () => void;
  onDeleteAccount: () => void;
}) {
  const [profile, setProfile] = useState<Profile | null>(null);
  const [editing, setEditing] = useState(false);
  const [city, setCity] = useState('');
  const { lang: language, setLang: changeLanguage, t } = useLang();
  const [birthdate, setBirthdate] = useState('');
  const [about, setAbout] = useState('');
  const [saving, setSaving] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [showAvatarMenu, setShowAvatarMenu] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  // ник
  const [editingNick, setEditingNick] = useState(false);
  const [newNick, setNewNick] = useState('');
  const [nickStatus, setNickStatus] = useState<'idle' | 'checking' | 'ok' | 'taken'>('idle');
  const [nickHint, setNickHint] = useState('');
  const [nickSaving, setNickSaving] = useState(false);

  const [loadError, setLoadError] = useState(false);

  // заблокированные
  const [showBlocked, setShowBlocked] = useState(false);
  // документы
  const [showDoc, setShowDoc] = useState<'privacy'|'terms'|'security'|null>(null);
  const [blocked, setBlocked] = useState<User[]>([]);

  // приватность
  const [showPrivacy, setShowPrivacy] = useState(false);
  const [privacyContent, setPrivacyContent] = useState<'all'|'followers'|'selected'>('all');
  const [privacyCalls, setPrivacyCalls] = useState<'all'|'followers'>('all');
  const [privacyMessages, setPrivacyMessages] = useState<'all'|'followers'>('all');

  // статистика
  const [showStats, setShowStats] = useState(false);
  const [stats, setStats] = useState<{ posts_count: number; total_likes: number; total_comments: number; total_views: number } | null>(null);

  // настройки (сворачиваемая секция)
  const [settingsOpen, setSettingsOpen] = useState(false);

  // мои публикации
  const [myPosts, setMyPosts] = useState<Post[]>([]);

  const loadBlocked = async () => {
    const d = await api(`blocked&user_id=${user.id}`);
    setBlocked((d.users as User[]) || []);
  };

  const loadPrivacy = async () => {
    const d = await api(`privacy_get&user_id=${user.id}`);
    const p = d.privacy as { privacy_content?: string; privacy_calls?: string; privacy_messages?: string } | undefined;
    if (p) {
      setPrivacyContent((p.privacy_content as 'all'|'followers'|'selected') || 'all');
      setPrivacyCalls((p.privacy_calls as 'all'|'followers') || 'all');
      setPrivacyMessages((p.privacy_messages as 'all'|'followers') || 'all');
    }
  };

  const updatePrivacy = async (fields: Partial<{ privacy_content: string; privacy_calls: string; privacy_messages: string }>) => {
    await api('privacy_update', 'POST', { user_id: user.id, ...fields });
  };

  const loadStats = async () => {
    const d = await api(`profile_stats&user_id=${user.id}`);
    setStats((d.stats as typeof stats) || null);
    setShowStats(true);
  };

  const loadMyPosts = async () => {
    const d = await api(`user_posts&user_id=${user.id}&owner_id=${user.id}`);
    setMyPosts((d.posts as Post[]) || []);
  };
  useEffect(() => { loadMyPosts(); }, [user.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const deletePost = async (postId: number) => {
    await api('post_delete', 'POST', { user_id: user.id, post_id: postId });
    setMyPosts(ps => ps.filter(p => p.id !== postId));
  };

  const load = async () => {
    setLoadError(false);
    const d = await api(`profile&user_id=${user.id}&me=${user.id}`);
    const p = d.user as Profile | undefined;
    if (!p) { setLoadError(true); return; }
    setProfile(p);
    setCity((p.city as string) || '');
    setBirthdate(p.birthdate ? (p.birthdate as string).slice(0, 10) : '');
    setAbout((p.about as string) || '');
  };
  useEffect(() => { load(); }, [user.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const pickAvatar = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]; if (!file) return;
    setShowAvatarMenu(false);
    const reader = new FileReader();
    reader.onload = async () => {
      const [header, b64] = (reader.result as string).split(',');
      const ext = header.includes('png') ? 'png' : 'jpg';
      const d = await api('upload_avatar', 'POST', { user_id: user.id, data: b64, ext });
      if (d.url) { onUpdate({ ...user, avatar_url: d.url }); load(); }
    };
    reader.readAsDataURL(file);
  };

  const removeAvatar = async () => {
    setShowAvatarMenu(false);
    await api('profile_update', 'POST', { user_id: user.id, avatar_url: null });
    onUpdate({ ...user, avatar_url: null });
    load();
  };

  const save = async () => {
    setSaving(true);
    const d = await api('profile_update', 'POST', { user_id: user.id, city: city || null, birthdate: birthdate || null, about: about || null });
    setSaving(false); setEditing(false);
    if (d.user) setProfile(d.user as Profile);
  };

  // проверка ника при вводе
  useEffect(() => {
    if (!editingNick) return;
    const q = newNick.trim().toLowerCase();
    if (q.length < 2) { setNickStatus('idle'); setNickHint(''); return; }
    if (q === profile?.nick) { setNickStatus('ok'); setNickHint(t('Это твой текущий ник')); return; }
    setNickStatus('checking');
    const tm = setTimeout(async () => {
      const d = await api(`check_nick&nick=${encodeURIComponent(q)}&user_id=${user.id}`);
      if (d.available) { setNickStatus('ok'); setNickHint(t('Ник свободен!')); }
      else { setNickStatus('taken'); setNickHint(d.error || t('Ник занят')); }
    }, 500);
    return () => clearTimeout(tm);
  }, [newNick, editingNick, profile?.nick, user.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const saveNick = async () => {
    const q = newNick.trim().toLowerCase();
    if (!q || nickStatus !== 'ok' || q === profile?.nick) { setEditingNick(false); return; }
    setNickSaving(true);
    const d = await api('change_nick', 'POST', { user_id: user.id, nick: q });
    setNickSaving(false);
    if (d.error) { setNickHint(d.error as string); setNickStatus('taken'); return; }
    if (d.user) onUpdate({ ...user, nick: (d.user as User).nick });
    setEditingNick(false);
    load();
  };



  return (
    <div className="flex flex-col h-full">
      {/* Фиксированный заголовок профиля */}
      <div className="shrink-0 px-4 pt-4 pb-3 bg-white dark:bg-slate-900 border-b border-slate-100 dark:border-slate-800 flex items-center justify-between">
        <h1 className="text-2xl font-bold text-slate-900 dark:text-slate-100" style={{ letterSpacing: '-0.5px' }}>{t('Профиль')}</h1>
      </div>
      {/* Скроллится только контент */}
      <div className="flex-1 overflow-y-auto scrollbar-thin bg-white dark:bg-slate-950">

      {!profile && !loadError && (
        <div className="flex flex-col items-center justify-center flex-1 gap-3 mt-20">
          <div className="w-8 h-8 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
          <p className="text-sm text-slate-400 dark:text-slate-500">{t('Загружаю профиль...')}</p>
        </div>
      )}
      {!profile && loadError && (
        <div className="flex flex-col items-center justify-center flex-1 gap-3 mt-20 px-6">
          <Icon name="WifiOff" size={40} className="text-slate-300" />
          <p className="text-sm text-slate-400 dark:text-slate-500 text-center">{t('Не удалось загрузить профиль')}</p>
          <button onClick={load} className="px-5 py-2.5 rounded-2xl bg-blue-600 text-white text-sm font-semibold">
            {t('Повторить')}
          </button>
        </div>
      )}
      {profile && (
        <div className="p-4 space-y-3 pb-8">
          {/* Аватар */}
          <div className="flex flex-col items-center pt-2 relative">
            <div className="relative cursor-pointer" onClick={() => setShowAvatarMenu(v => !v)}>
              <Avatar url={profile.avatar_url} nick={profile.nick} size={88} />
              <div className="absolute -bottom-1 -right-1 w-8 h-8 rounded-full bg-blue-600 flex items-center justify-center shadow-md">
                <Icon name="Camera" size={14} className="text-white" />
              </div>
            </div>
            <input ref={fileRef} type="file" accept="image/*" hidden onChange={pickAvatar} />
            {showAvatarMenu && (
              <div className="absolute top-24 bg-white dark:bg-slate-900 rounded-2xl p-1 z-50 w-52 shadow-xl border border-slate-100 dark:border-slate-800">
                <button onClick={() => { setShowAvatarMenu(false); fileRef.current?.click(); }} className="w-full flex items-center gap-3 px-4 py-3 rounded-xl hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors text-sm text-slate-700 dark:text-slate-200">
                  <Icon name="Camera" size={16} className="text-blue-600" /> {t('Изменить фото')}
                </button>
                {profile.avatar_url && (
                  <button onClick={removeAvatar} className="w-full flex items-center gap-3 px-4 py-3 rounded-xl hover:bg-red-50 dark:hover:bg-red-950/30 transition-colors text-sm text-red-500">
                    <Icon name="Trash2" size={16} /> {t('Удалить фото')}
                  </button>
                )}
              </div>
            )}
            {!editingNick ? (
              <button onClick={() => { setNewNick(profile.nick); setEditingNick(true); setNickStatus('idle'); setNickHint(''); }} className="flex items-center gap-2 mt-4 group">
                <h2 className="font-bold text-2xl text-slate-800 dark:text-slate-100 flex items-center gap-1.5">@{profile.nick}{profile.is_verified && <VerifiedBadge size={19} />}</h2>
                <Icon name="Pencil" size={15} className="text-slate-300 group-hover:text-slate-500 transition-colors" />
              </button>
            ) : (
              <div className="mt-4 w-full px-4">
                <div className="relative mb-1">
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 dark:text-slate-500 text-sm">@</span>
                  <input autoFocus value={newNick}
                    onChange={(e) => setNewNick(e.target.value.replace(/[^a-zA-Z0-9_]/g, '').toLowerCase())}
                    onKeyDown={(e) => { if (e.key === 'Enter') saveNick(); if (e.key === 'Escape') setEditingNick(false); }}
                    maxLength={30}
                    className="w-full bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-2xl pl-8 pr-10 py-2.5 outline-none focus:ring-2 focus:ring-blue-500 transition-all text-center font-bold text-lg text-slate-800 dark:text-slate-100" />
                  <span className="absolute right-3 top-1/2 -translate-y-1/2">
                    {nickStatus === 'checking' && <span className="w-4 h-4 border-2 border-blue-500 border-t-transparent rounded-full animate-spin block" />}
                    {nickStatus === 'ok' && <Icon name="Check" size={15} className="text-green-500" />}
                    {nickStatus === 'taken' && <Icon name="X" size={15} className="text-red-500" />}
                  </span>
                </div>
                <p className={`text-xs text-center mb-2 h-4 ${nickStatus === 'ok' ? 'text-green-500' : 'text-red-500'}`}>{nickHint}</p>
                <div className="flex gap-2">
                  <button onClick={saveNick} disabled={nickSaving || nickStatus !== 'ok'} className="flex-1 py-2 rounded-xl bg-blue-600 text-white text-sm font-semibold disabled:opacity-40">
                    {nickSaving ? '...' : t('Сохранить')}
                  </button>
                  <button onClick={() => setEditingNick(false)} className="flex-1 py-2 rounded-xl bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 text-sm font-medium">{t('Отмена')}</button>
                </div>
              </div>
            )}
            <div className="flex gap-8 mt-4">
              <button onClick={() => onFollowers(user.id, 'followers')} className="flex flex-col items-center hover:text-blue-600 transition-colors">
                <span className="font-bold text-xl text-slate-800 dark:text-slate-100">{profile.followers}</span>
                <span className="text-xs text-slate-400 dark:text-slate-500">{t('подписчиков')}</span>
              </button>
              <button onClick={() => onFollowers(user.id, 'following')} className="flex flex-col items-center hover:text-blue-600 transition-colors">
                <span className="font-bold text-xl text-slate-800 dark:text-slate-100">{profile.following}</span>
                <span className="text-xs text-slate-400 dark:text-slate-500">{t('подписок')}</span>
              </button>
            </div>
          </div>

          {/* Инфо / редактирование */}
          {!editing ? (
            <div className="bg-white dark:bg-slate-900 rounded-3xl p-5 space-y-3 border border-slate-100 dark:border-slate-800">
              {profile.city && <div className="flex items-center gap-2 text-sm text-slate-700 dark:text-slate-200"><Icon name="MapPin" size={15} className="text-blue-500" />{profile.city}</div>}
              {profile.birthdate && <div className="flex items-center gap-2 text-sm text-slate-700 dark:text-slate-200"><Icon name="Cake" size={15} className="text-blue-500" />{new Date(profile.birthdate).toLocaleDateString('ru-RU')}</div>}
              {profile.about && <p className="text-sm text-slate-500 dark:text-slate-400 leading-relaxed">{profile.about}</p>}
              {!profile.city && !profile.birthdate && !profile.about && <p className="text-sm text-slate-400 dark:text-slate-500">{t('Профиль не заполнен')}</p>}
              <button onClick={() => setEditing(true)} className="w-full py-3 rounded-2xl font-medium bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-700 transition-colors mt-2 text-slate-700 dark:text-slate-200 text-sm">
                <Icon name="Pencil" size={15} className="inline mr-2 text-blue-500" />{t('Редактировать')}
              </button>
            </div>
          ) : (
            <div className="bg-white dark:bg-slate-900 rounded-3xl p-5 space-y-4 border border-slate-100 dark:border-slate-800">
              <div>
                <label className="text-xs text-slate-400 dark:text-slate-500 mb-1 block font-medium">{t('Город')}</label>
                <input value={city} onChange={(e) => setCity(e.target.value)} placeholder={t('Москва')} className="w-full bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-2xl px-4 py-3 outline-none focus:ring-2 focus:ring-blue-500 transition-all text-slate-800 dark:text-slate-100 text-sm" />
              </div>
              <div>
                <label className="text-xs text-slate-400 dark:text-slate-500 mb-1 block font-medium">{t('Дата рождения')}</label>
                <input type="date" value={birthdate} onChange={(e) => setBirthdate(e.target.value)} className="w-full bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-2xl px-4 py-3 outline-none focus:ring-2 focus:ring-blue-500 transition-all text-slate-800 dark:text-slate-100 text-sm" />
              </div>
              <div>
                <label className="text-xs text-slate-400 dark:text-slate-500 mb-1 block font-medium">{t('О себе')}</label>
                <textarea value={about} onChange={(e) => setAbout(e.target.value)} rows={3} className="w-full bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-2xl px-4 py-3 outline-none focus:ring-2 focus:ring-blue-500 transition-all resize-none text-slate-800 dark:text-slate-100 text-sm" />
              </div>

              <div className="pt-2 border-t border-slate-100 dark:border-slate-800">
                <button onClick={() => { loadPrivacy(); setShowPrivacy(true); }}
                  className="w-full flex items-center gap-3 py-2.5 px-1 rounded-xl hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors">
                  <div className="w-9 h-9 rounded-2xl bg-purple-100 flex items-center justify-center shrink-0">
                    <Icon name="Eye" size={17} className="text-purple-500" />
                  </div>
                  <div className="flex-1 text-left">
                    <span className="text-sm font-medium text-slate-700 dark:text-slate-200">{t('Кто видит фото, видео и текст')}</span>
                    <p className="text-xs text-slate-400 dark:text-slate-500">
                      {privacyContent === 'all' ? t('Все') : privacyContent === 'followers' ? t('Только подписчики') : t('Выбранные люди')}
                    </p>
                  </div>
                  <Icon name="ChevronRight" size={16} className="text-slate-300 dark:text-slate-600" />
                </button>
                <button onClick={() => { loadPrivacy(); setShowPrivacy(true); }}
                  className="w-full flex items-center gap-3 py-2.5 px-1 rounded-xl hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors">
                  <div className="w-9 h-9 rounded-2xl bg-green-100 flex items-center justify-center shrink-0">
                    <Icon name="PhoneCall" size={17} className="text-green-600" />
                  </div>
                  <div className="flex-1 text-left">
                    <span className="text-sm font-medium text-slate-700 dark:text-slate-200">{t('Кто может звонить и писать')}</span>
                    <p className="text-xs text-slate-400 dark:text-slate-500">
                      {privacyCalls === 'all' ? t('Все') : t('Только подписчики')}
                    </p>
                  </div>
                  <Icon name="ChevronRight" size={16} className="text-slate-300 dark:text-slate-600" />
                </button>
              </div>

              <div className="flex gap-2">
                <button onClick={save} disabled={saving} className="flex-1 py-3 rounded-2xl font-semibold bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50 transition-all text-sm">
                  {saving ? t('Сохраняю...') : t('Сохранить')}
                </button>
                <button onClick={() => setEditing(false)} className="flex-1 py-3 rounded-2xl bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 text-sm font-medium hover:bg-slate-200 dark:hover:bg-slate-700 transition-colors">{t('Отмена')}</button>
              </div>
            </div>
          )}

          {/* Мои публикации */}
          <div className="bg-white dark:bg-slate-900 rounded-3xl p-5 border border-slate-100 dark:border-slate-800">
            <div className="flex items-center justify-between mb-3">
              <p className="text-xs text-slate-400 dark:text-slate-500 font-semibold uppercase tracking-wider px-1">{t('Мои публикации')}</p>
              <button onClick={loadStats} className="text-xs font-semibold text-blue-600 flex items-center gap-1 px-1">
                <Icon name="BarChart2" size={13} /> {t('Статистика')}
              </button>
            </div>
            {myPosts.length === 0 ? (
              <p className="text-sm text-slate-400 dark:text-slate-500 py-4 text-center">{t('Пока нет публикаций')}</p>
            ) : (
              <div className="grid grid-cols-3 gap-1.5">
                {myPosts.map(p => (
                  <div key={p.id} className="relative aspect-square rounded-xl overflow-hidden bg-slate-100 dark:bg-slate-800 group">
                    {p.type === 'text'
                      ? <div className="w-full h-full flex items-center justify-center p-2"><span className="text-xs text-slate-500 dark:text-slate-400 line-clamp-4 text-center">{p.content}</span></div>
                      : p.type === 'video'
                        ? <video src={p.content} className="w-full h-full object-cover" />
                        : <img src={p.content} className="w-full h-full object-cover" />}
                    <button onClick={() => deletePost(p.id)}
                      className="absolute top-1 right-1 w-6 h-6 rounded-full bg-black/60 flex items-center justify-center opacity-0 group-active:opacity-100 transition-opacity">
                      <Icon name="Trash2" size={12} className="text-white" />
                    </button>
                    <div className="absolute bottom-1 left-1 flex items-center gap-1 bg-black/50 rounded-full px-1.5 py-0.5">
                      <Icon name="Heart" size={10} className="text-white" />
                      <span className="text-[10px] text-white font-medium">{p.likes_count}</span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Настройки — сворачиваемая секция со всем внутри */}
          <div className="bg-white dark:bg-slate-900 rounded-3xl p-5 border border-slate-100 dark:border-slate-800">
            <button onClick={() => setSettingsOpen(v => !v)} className="w-full flex items-center gap-3 py-1 px-1">
              <div className="w-9 h-9 rounded-2xl bg-slate-100 dark:bg-slate-800 flex items-center justify-center shrink-0">
                <Icon name="Settings" size={18} className="text-slate-500 dark:text-slate-300" />
              </div>
              <span className="text-sm font-semibold text-slate-800 dark:text-slate-100 flex-1 text-left">{t('Настройки')}</span>
              <Icon name={settingsOpen ? 'ChevronUp' : 'ChevronDown'} size={18} className="text-slate-400 dark:text-slate-500" />
            </button>
            {settingsOpen && (
              <div className="space-y-1 mt-3 pt-3 border-t border-slate-100 dark:border-slate-800">
                <button onClick={onToggleTheme} className="w-full flex items-center gap-3 py-2 px-1 rounded-xl hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors">
                  <div className="w-9 h-9 rounded-2xl bg-amber-100 flex items-center justify-center shrink-0">
                    <Icon name={lightTheme ? 'Sun' : 'Moon'} size={18} className="text-amber-500" />
                  </div>
                  <div className="flex-1 text-left">
                    <span className="text-sm font-medium text-slate-700 dark:text-slate-200">{lightTheme ? t('Светлая тема') : t('Тёмная тема')}</span>
                    <p className="text-xs text-slate-400 dark:text-slate-500">{t('Нажмите, чтобы переключить')}</p>
                  </div>
                </button>
                <div className="flex items-center gap-3 py-2 px-1">
                  <div className="w-9 h-9 rounded-2xl bg-green-100 flex items-center justify-center shrink-0">
                    <Icon name="Globe" size={18} className="text-green-600" />
                  </div>
                  <div className="flex-1">
                    <span className="text-sm font-medium text-slate-700 dark:text-slate-200">{t('Язык')}</span>
                    <p className="text-xs text-slate-400 dark:text-slate-500">{t('Язык приложения')}</p>
                  </div>
                  <div className="flex bg-slate-100 dark:bg-slate-800 rounded-full p-0.5">
                    <button onClick={() => changeLanguage('ru')} className={`px-3 py-1 rounded-full text-xs font-medium transition-colors ${language === 'ru' ? 'bg-white dark:bg-slate-700 text-slate-800 dark:text-slate-100 shadow-sm' : 'text-slate-400 dark:text-slate-500'}`}>RU</button>
                    <button onClick={() => changeLanguage('en')} className={`px-3 py-1 rounded-full text-xs font-medium transition-colors ${language === 'en' ? 'bg-white dark:bg-slate-700 text-slate-800 dark:text-slate-100 shadow-sm' : 'text-slate-400 dark:text-slate-500'}`}>EN</button>
                  </div>
                </div>
                <button onClick={() => { loadPrivacy(); setShowPrivacy(true); }} className="w-full flex items-center gap-3 py-2 px-1 rounded-xl hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors">
                  <div className="w-9 h-9 rounded-2xl bg-purple-100 flex items-center justify-center shrink-0">
                    <Icon name="Eye" size={18} className="text-purple-500" />
                  </div>
                  <div className="flex-1 text-left">
                    <span className="text-sm font-medium text-slate-700 dark:text-slate-200">{t('Приватность')}</span>
                    <p className="text-xs text-slate-400 dark:text-slate-500">{t('Кто видит фото, видео и текст')}</p>
                  </div>
                  <Icon name="ChevronRight" size={16} className="text-slate-300 dark:text-slate-600" />
                </button>
                <button onClick={() => { setShowBlocked(true); loadBlocked(); }}
                  className="w-full flex items-center gap-3 py-2 px-1 hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors rounded-xl">
                  <div className="w-9 h-9 rounded-2xl bg-red-100 flex items-center justify-center shrink-0">
                    <Icon name="Ban" size={18} className="text-red-500" />
                  </div>
                  <span className="text-sm text-slate-700 dark:text-slate-200 flex-1 text-left">{t('Заблокированные')}</span>
                  <Icon name="ChevronRight" size={16} className="text-slate-300 dark:text-slate-600" />
                </button>
                {[
                  { label: t('Политика конфиденциальности'), icon: 'Shield', doc: 'privacy' as const },
                  { label: t('Пользовательское соглашение'), icon: 'FileText', doc: 'terms' as const },
                  { label: t('Шифрование и безопасность'), icon: 'Lock', doc: 'security' as const },
                ].map(item => (
                  <button key={item.doc} onClick={() => setShowDoc(item.doc)}
                    className="w-full flex items-center gap-3 py-2 px-1 hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors rounded-xl">
                    <div className="w-9 h-9 rounded-2xl bg-indigo-100 flex items-center justify-center shrink-0">
                      <Icon name={item.icon} size={18} className="text-indigo-500" />
                    </div>
                    <span className="text-sm text-slate-700 dark:text-slate-200 flex-1 text-left">{item.label}</span>
                    <Icon name="ChevronRight" size={16} className="text-slate-300 dark:text-slate-600" />
                  </button>
                ))}
                <button onClick={onLogout} className="w-full flex items-center gap-3 py-2 px-1 rounded-2xl hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors">
                  <div className="w-9 h-9 rounded-2xl bg-slate-100 dark:bg-slate-800 flex items-center justify-center shrink-0">
                    <Icon name="LogOut" size={18} className="text-slate-500 dark:text-slate-400" />
                  </div>
                  <span className="text-sm font-medium text-slate-700 dark:text-slate-200">{t('Выйти')}</span>
                </button>
                {!confirmDelete ? (
                  <button onClick={() => setConfirmDelete(true)} className="w-full flex items-center gap-3 py-2 px-1 rounded-2xl hover:bg-red-50 dark:hover:bg-red-950/30 transition-colors">
                    <div className="w-9 h-9 rounded-2xl bg-red-100 flex items-center justify-center shrink-0">
                      <Icon name="Trash2" size={18} className="text-red-500" />
                    </div>
                    <span className="text-sm font-medium text-red-500">{t('Удалить аккаунт')}</span>
                  </button>
                ) : (
                  <div className="pt-2">
                    <p className="text-sm text-red-500 mb-3 px-1">{t('Удалить аккаунт навсегда? Это нельзя отменить.')}</p>
                    <div className="flex gap-2">
                      <button onClick={onDeleteAccount} className="flex-1 py-2.5 rounded-2xl bg-red-500 text-white text-sm font-semibold">{t('Удалить')}</button>
                      <button onClick={() => setConfirmDelete(false)} className="flex-1 py-2.5 rounded-2xl bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 text-sm font-medium">{t('Отмена')}</button>
                    </div>
                  </div>
                )}
                <div className="pt-2 px-1">
                  <p className="text-xs text-slate-400 dark:text-slate-500">{t('Вай Мессенджер v1.0 · Соответствует ФЗ-152')}</p>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
      </div>

      {/* Модальное окно заблокированных */}
      {showBlocked && (
        <div className="fixed inset-0 z-50 bg-black/40 flex items-end" onClick={() => setShowBlocked(false)}>
          <div className="bg-white dark:bg-slate-900 rounded-t-3xl w-full max-h-[70vh] overflow-y-auto p-5" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-bold text-slate-800 dark:text-slate-100">{t('Заблокированные')}</h3>
              <button onClick={() => setShowBlocked(false)}><Icon name="X" size={20} className="text-slate-400 dark:text-slate-500" /></button>
            </div>
            {blocked.length === 0
              ? <p className="text-center text-slate-400 dark:text-slate-500 py-8">{t('Никого нет')}</p>
              : blocked.map(u => (
                <div key={u.id} className="flex items-center gap-3 py-3 border-b border-slate-50 dark:border-slate-800">
                  <Avatar url={u.avatar_url} nick={u.nick} size={44} />
                  <span className="flex-1 font-semibold text-slate-800 dark:text-slate-100">@{u.nick}</span>
                  <button onClick={async () => {
                    await api('unblock', 'POST', { user_id: user.id, target_id: u.id });
                    setBlocked(bs => bs.filter(b => b.id !== u.id));
                  }} className="px-4 py-1.5 rounded-full border border-slate-200 dark:border-slate-700 text-sm text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800">
                    {t('Разблокировать')}
                  </button>
                </div>
              ))
            }
          </div>
        </div>
      )}

      {/* Модальное окно документов */}
      {showDoc && (
        <div className="fixed inset-0 z-50 bg-black/40 flex items-end" onClick={() => setShowDoc(null)}>
          <div className="bg-white dark:bg-slate-900 rounded-t-3xl w-full max-h-[85vh] flex flex-col" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between px-5 pt-5 pb-3 border-b border-slate-100 dark:border-slate-800 shrink-0">
              <h3 className="font-bold text-slate-800 dark:text-slate-100 text-lg">
                {showDoc === 'privacy' ? t('Политика конфиденциальности')
                  : showDoc === 'terms' ? t('Пользовательское соглашение')
                  : t('Шифрование и безопасность')}
              </h3>
              <button onClick={() => setShowDoc(null)}><Icon name="X" size={20} className="text-slate-400 dark:text-slate-500" /></button>
            </div>
            <div className="overflow-y-auto flex-1 px-5 py-4 space-y-4 text-sm text-slate-700 dark:text-slate-200 leading-relaxed">
              {showDoc === 'privacy' && <>
                <p className="font-bold text-slate-900">{t('Политика конфиденциальности Вай Мессенджер')}</p>
                <p className="text-xs text-slate-400">{t('Редакция от 01.07.2026. Соответствует требованиям ФЗ-152 «О персональных данных».')}</p>
                <p><span className="font-semibold">{t('1. Оператор персональных данных.')}</span> {t('Вай Мессенджер является оператором персональных данных в соответствии с Федеральным законом № 152-ФЗ «О персональных данных».')}</p>
                <p><span className="font-semibold">{t('2. Какие данные мы собираем.')}</span> {t('При регистрации: имя пользователя (никнейм), пароль в зашифрованном виде (SHA-256). Дополнительно по желанию: город, дата рождения, фотография профиля, информация «О себе».')}</p>
                <p><span className="font-semibold">{t('3. Сообщения.')}</span> {t('Текстовые сообщения, фото, видео, аудио и файлы хранятся на серверах для обеспечения доставки. Удалённые вами сообщения физически помечаются как удалённые и не отображаются ни одной из сторон.')}</p>
                <p><span className="font-semibold">{t('4. Как мы используем данные.')}</span> {t('Данные используются исключительно для обеспечения работы мессенджера: авторизации, отправки сообщений, звонков и уведомлений. Данные не передаются третьим лицам и не используются в рекламных целях.')}</p>
                <p><span className="font-semibold">{t('5. Хранение данных.')}</span> {t('Данные хранятся на серверах, расположенных на территории Российской Федерации, в соответствии с требованиями ст. 18 ФЗ-152.')}</p>
                <p><span className="font-semibold">{t('6. Права пользователя.')}</span> {t('Вы вправе: получить доступ к своим данным; исправить неточные данные; удалить аккаунт и все связанные данные (кнопка «Удалить аккаунт» в профиле); отозвать согласие на обработку персональных данных.')}</p>
                <p><span className="font-semibold">{t('7. Удаление аккаунта.')}</span> {t('При удалении аккаунта все персональные данные, сообщения и медиафайлы пользователя удаляются безвозвратно в течение 30 дней.')}</p>
                <p><span className="font-semibold">{t('8. Уведомления.')}</span> {t('Push-уведомления отправляются через сервис OneSignal. Вы можете отключить их в настройках устройства в любое время.')}</p>
                <p><span className="font-semibold">{t('9. Возраст.')}</span> {t('Сервис предназначен для лиц старше 14 лет. Регистрация лиц младше 14 лет допускается только с согласия родителей или законных представителей.')}</p>
                <p><span className="font-semibold">{t('10. Контакты.')}</span> {t('По вопросам обработки персональных данных: поддержка доступна через раздел помощи в приложении.')}</p>
              </>}
              {showDoc === 'terms' && <>
                <p className="font-bold text-slate-900">{t('Пользовательское соглашение Вай Мессенджер')}</p>
                <p className="text-xs text-slate-400">{t('Редакция от 01.07.2026.')}</p>
                <p><span className="font-semibold">{t('1. Принятие условий.')}</span> {t('Регистрируясь в Вай Мессенджер, вы соглашаетесь с настоящим соглашением и Политикой конфиденциальности.')}</p>
                <p><span className="font-semibold">{t('2. Регистрация.')}</span> {t('При регистрации вы обязуетесь предоставить достоверные данные. Один пользователь — один аккаунт. Запрещается создавать аккаунты от имени других лиц.')}</p>
                <p><span className="font-semibold">{t('3. Правила использования.')}</span> {t('Запрещается: распространять незаконный контент; осуществлять спам-рассылки; использовать сервис для мошенничества; нарушать права других пользователей; распространять вирусы и вредоносное ПО.')}</p>
                <p><span className="font-semibold">{t('4. Контент пользователей.')}</span> {t('Вы несёте ответственность за все сообщения и медиафайлы, отправленные через сервис. Контент, нарушающий законодательство РФ, может быть удалён.')}</p>
                <p><span className="font-semibold">{t('5. Звонки.')}</span> {t('Голосовые и видеозвонки осуществляются через технологию WebRTC напрямую между устройствами (peer-to-peer) там, где это возможно. Запись звонков без согласия собеседника запрещена и является нарушением ст. 138 УК РФ.')}</p>
                <p><span className="font-semibold">{t('6. Блокировка.')}</span> {t('Администрация вправе заблокировать аккаунт при нарушении настоящего соглашения или законодательства РФ.')}</p>
                <p><span className="font-semibold">{t('7. Ответственность.')}</span> {t('Сервис предоставляется «как есть». Мы не несём ответственности за содержание переписки между пользователями.')}</p>
                <p><span className="font-semibold">{t('8. Применимое право.')}</span> {t('Настоящее соглашение регулируется законодательством Российской Федерации.')}</p>
              </>}
              {showDoc === 'security' && <>
                <p className="font-bold text-slate-900">{t('Шифрование и безопасность')}</p>
                <p><span className="font-semibold">{t('Пароли.')}</span> {t('Пароли хранятся в виде хэша SHA-256. Оригинальный пароль нигде не сохраняется и не может быть восстановлен.')}</p>
                <p><span className="font-semibold">{t('Передача данных.')}</span> {t('Все соединения между приложением и сервером защищены протоколом HTTPS/TLS 1.3. Данные передаются в зашифрованном виде.')}</p>
                <p><span className="font-semibold">{t('Звонки (WebRTC).')}</span> {t('Голосовые и видеозвонки используют технологию WebRTC со встроенным шифрованием DTLS-SRTP. Медиапоток шифруется на уровне протокола между устройствами участников звонка.')}</p>
                <p><span className="font-semibold">{t('Медиафайлы.')}</span> {t('Фотографии, видео, аудио и файлы хранятся в защищённом S3-совместимом хранилище с доступом по уникальным ссылкам.')}</p>
                <p><span className="font-semibold">{t('Уведомления.')}</span> {t('Push-уведомления содержат минимум данных (ник отправителя, тип события) и не включают содержимое сообщений.')}</p>
                <p><span className="font-semibold">{t('Серверы.')}</span> {t('Серверная инфраструктура расположена на территории РФ в соответствии с требованиями ФЗ-152 о локализации персональных данных.')}</p>
                <p><span className="font-semibold">{t('Сессии.')}</span> {t('Ваш сеанс хранится локально на устройстве. При выходе из аккаунта сессия завершается и статус «онлайн» сбрасывается.')}</p>
                <p className="text-xs text-slate-400 pt-2">{t('Если вы обнаружили уязвимость — сообщите нам через поддержку в приложении.')}</p>
              </>}
            </div>
          </div>
        </div>
      )}

      {/* Модальное окно приватности */}
      {showPrivacy && (
        <div className="fixed inset-0 z-50 bg-black/40 flex items-end" onClick={() => setShowPrivacy(false)}>
          <div className="bg-white dark:bg-slate-900 rounded-t-3xl w-full max-h-[80vh] overflow-y-auto p-5" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-bold text-slate-800 dark:text-slate-100">{t('Приватность')}</h3>
              <button onClick={() => setShowPrivacy(false)}><Icon name="X" size={20} className="text-slate-400 dark:text-slate-500" /></button>
            </div>

            <p className="text-xs font-semibold text-slate-400 dark:text-slate-500 uppercase tracking-wider mb-2 px-1">{t('Кто видит мои фото, видео и текст')}</p>
            <div className="space-y-1 mb-5">
              {([
                { key: 'all' as const, label: t('Все') },
                { key: 'followers' as const, label: t('Только подписчики') },
                { key: 'selected' as const, label: t('Выбранные люди') },
              ]).map(opt => (
                <button key={opt.key} onClick={() => { setPrivacyContent(opt.key); updatePrivacy({ privacy_content: opt.key }); }}
                  className="w-full flex items-center gap-3 py-2.5 px-2 rounded-xl hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors">
                  <div className={`w-5 h-5 rounded-full border-2 flex items-center justify-center shrink-0 ${privacyContent === opt.key ? 'border-blue-600' : 'border-slate-300 dark:border-slate-600'}`}>
                    {privacyContent === opt.key && <div className="w-2.5 h-2.5 rounded-full bg-blue-600" />}
                  </div>
                  <span className="text-sm text-slate-700 dark:text-slate-200">{opt.label}</span>
                </button>
              ))}
            </div>

            <p className="text-xs font-semibold text-slate-400 dark:text-slate-500 uppercase tracking-wider mb-2 px-1">{t('Кто может мне звонить и писать')}</p>
            <div className="space-y-1">
              {([
                { key: 'all' as const, label: t('Все') },
                { key: 'followers' as const, label: t('Только подписчики') },
              ]).map(opt => (
                <button key={opt.key} onClick={() => { setPrivacyCalls(opt.key); setPrivacyMessages(opt.key); updatePrivacy({ privacy_calls: opt.key, privacy_messages: opt.key }); }}
                  className="w-full flex items-center gap-3 py-2.5 px-2 rounded-xl hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors">
                  <div className={`w-5 h-5 rounded-full border-2 flex items-center justify-center shrink-0 ${privacyCalls === opt.key ? 'border-blue-600' : 'border-slate-300 dark:border-slate-600'}`}>
                    {privacyCalls === opt.key && <div className="w-2.5 h-2.5 rounded-full bg-blue-600" />}
                  </div>
                  <span className="text-sm text-slate-700 dark:text-slate-200">{opt.label}</span>
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Модальное окно статистики */}
      {showStats && (
        <div className="fixed inset-0 z-50 bg-black/40 flex items-end" onClick={() => setShowStats(false)}>
          <div className="bg-white dark:bg-slate-900 rounded-t-3xl w-full p-5" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-5">
              <h3 className="font-bold text-slate-800 dark:text-slate-100">{t('Статистика')}</h3>
              <button onClick={() => setShowStats(false)}><Icon name="X" size={20} className="text-slate-400 dark:text-slate-500" /></button>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="bg-slate-50 dark:bg-slate-800 rounded-2xl p-4 flex flex-col items-center gap-1">
                <Icon name="Image" size={20} className="text-blue-500" />
                <span className="font-bold text-xl text-slate-800 dark:text-slate-100">{stats?.posts_count ?? 0}</span>
                <span className="text-xs text-slate-400 dark:text-slate-500">{t('Публикаций')}</span>
              </div>
              <div className="bg-slate-50 dark:bg-slate-800 rounded-2xl p-4 flex flex-col items-center gap-1">
                <Icon name="Heart" size={20} className="text-red-500" />
                <span className="font-bold text-xl text-slate-800 dark:text-slate-100">{stats?.total_likes ?? 0}</span>
                <span className="text-xs text-slate-400 dark:text-slate-500">{t('Лайков')}</span>
              </div>
              <div className="bg-slate-50 dark:bg-slate-800 rounded-2xl p-4 flex flex-col items-center gap-1">
                <Icon name="MessageCircle" size={20} className="text-green-500" />
                <span className="font-bold text-xl text-slate-800 dark:text-slate-100">{stats?.total_comments ?? 0}</span>
                <span className="text-xs text-slate-400 dark:text-slate-500">{t('Комментариев')}</span>
              </div>
              <div className="bg-slate-50 dark:bg-slate-800 rounded-2xl p-4 flex flex-col items-center gap-1">
                <Icon name="Eye" size={20} className="text-purple-500" />
                <span className="font-bold text-xl text-slate-800 dark:text-slate-100">{stats?.total_views ?? 0}</span>
                <span className="text-xs text-slate-400 dark:text-slate-500">{t('Просмотров')}</span>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════════════
// CHAT SCREEN
// ── WEBRTC CALL ──────────────────────────────────────────────────────────────
// Fallback ICE пока не загрузились с бэкенда (только STUN, без пароля в коде)
const ICE_FALLBACK = {
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun.cloudflare.com:3478' },
  ],
  iceCandidatePoolSize: 10,
};

function WebRTCCall({ user, peer, callId, kind, outgoing, onEnd }: {
  user: User; peer: User; callId: string; kind: 'audio' | 'video'; outgoing: boolean; onEnd: () => void;
}) {
  const { t } = useLang();
  const [status, setStatus]     = useState<'ringing' | 'active'>('ringing');
  const [micOn,  setMicOn]      = useState(true);
  const [camOn,  setCamOn]      = useState(kind === 'video');
  const [duration, setDuration] = useState(0);
  // Аудио: громкий (динамик) / тихий (ухо)
  const [speakerOn, setSpeakerOn] = useState(true);
  // Видео: фронт/тыл камера
  const [facingMode, setFacingMode] = useState<'user' | 'environment'>('user');
  // Видео: своё видео большое или маленькое
  const [selfBig, setSelfBig] = useState(false);

  // Гудки при исходящем звонке — пока не ответили
  useEffect(() => {
    if (outgoing && status === 'ringing') startRingback();
    else stopRingback();
    return () => stopRingback();
  }, [outgoing, status]);

  const localRef    = useRef<HTMLVideoElement>(null);
  const remoteRef   = useRef<HTMLVideoElement>(null);
  const remoteAudio = useRef<HTMLAudioElement>(null);
  const stateRef = useRef({
    pc:          null as RTCPeerConnection | null,
    stream:      null as MediaStream | null,
    ended:       false,
    lastSigId:   0,
    pendingIce:  [] as RTCIceCandidateInit[],
    pollTimer:   null as ReturnType<typeof setInterval> | null,
    durTimer:    null as ReturnType<typeof setInterval> | null,
  });

  const sig = (type: string, payload: object) =>
    api('call_signal', 'POST', {
      call_id: callId, from_user_id: user.id, to_user_id: peer.id,
      type, payload: JSON.stringify(payload), kind,
    });

  const doEnd = () => {
    const s = stateRef.current;
    if (s.ended) return;
    s.ended = true;
    if (s.pollTimer) clearInterval(s.pollTimer);
    if (s.durTimer)  clearInterval(s.durTimer);
    s.stream?.getTracks().forEach(t => t.stop());
    s.pc?.close();
    s.pc = null;
    onEnd();
  };

  const processSignal = async (type: string, payload: string) => {
    const s  = stateRef.current;
    const pc = s.pc;
    if (!pc || s.ended) return;
    const data = JSON.parse(payload || '{}');
    if (type === 'offer') {
      if (pc.signalingState !== 'stable') return;
      await pc.setRemoteDescription(new RTCSessionDescription(data));
      for (const c of s.pendingIce) { try { await pc.addIceCandidate(c); } catch {/**/} }
      s.pendingIce = [];
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);
      await sig('answer', answer);
    } else if (type === 'answer') {
      if (pc.signalingState !== 'have-local-offer') return;
      await pc.setRemoteDescription(new RTCSessionDescription(data));
      for (const c of s.pendingIce) { try { await pc.addIceCandidate(c); } catch {/**/} }
      s.pendingIce = [];
    } else if (type === 'ice') {
      if (pc.remoteDescription) {
        try { await pc.addIceCandidate(new RTCIceCandidate(data)); } catch {/**/}
      } else { s.pendingIce.push(data); }
    } else if (type === 'end' || type === 'reject') { doEnd(); }
  };

  useEffect(() => {
    document.body.style.overflow = 'hidden';
    document.body.style.position = 'fixed';
    document.body.style.width    = '100%';
    const s = stateRef.current;

    const boot = async () => {
      let iceConfig: RTCConfiguration = ICE_FALLBACK;
      try {
        const iceData = await api('get_ice_servers');
        if (iceData?.iceServers?.length)
          iceConfig = { iceServers: iceData.iceServers, iceCandidatePoolSize: 10 };
      } catch {/**/}

      const stream = await navigator.mediaDevices.getUserMedia(
        kind === 'video'
          ? { audio: true, video: { facingMode: 'user', width: { ideal: 1280 }, height: { ideal: 720 } } }
          : { audio: true, video: false }
      );
      if (s.ended) { stream.getTracks().forEach(t => t.stop()); return; }
      s.stream = stream;

      if (localRef.current) { localRef.current.srcObject = stream; localRef.current.muted = true; }

      const pc = new RTCPeerConnection(iceConfig);
      s.pc = pc;
      stream.getTracks().forEach(t => pc.addTrack(t, stream));

      pc.ontrack = (e) => {
        const rs = e.streams[0];
        if (!rs) return;
        if (kind === 'video' && remoteRef.current) {
          remoteRef.current.srcObject = rs;
          remoteRef.current.play().catch(() => {});
        }
        if (kind === 'audio' && remoteAudio.current) {
          remoteAudio.current.srcObject = rs;
          remoteAudio.current.play().catch(() => {});
        }
      };

      pc.onicecandidate = (e) => { if (e.candidate && !s.ended) sig('ice', e.candidate.toJSON()); };
      pc.onconnectionstatechange = () => {
        if (s.ended) return;
        console.log('[WebRTC] state:', pc.connectionState);
        if (pc.connectionState === 'connected') {
          setStatus('active');
          s.durTimer = setInterval(() => setDuration(d => d + 1), 1000);
        }
        if (pc.connectionState === 'failed') doEnd();
        if (pc.connectionState === 'disconnected')
          setTimeout(() => { if (stateRef.current.pc?.connectionState === 'disconnected') doEnd(); }, 5000);
      };

      if (outgoing) {
        const offer = await pc.createOffer({ offerToReceiveAudio: true, offerToReceiveVideo: kind === 'video' });
        await pc.setLocalDescription(offer);
        await sig('offer', offer);
      }

      s.pollTimer = setInterval(async () => {
        if (s.ended) return;
        try {
          const d = await api(`call_poll&user_id=${user.id}&call_id=${callId}&after=${s.lastSigId}`);
          for (const item of (d.signals || [])) {
            s.lastSigId = item.id;
            await processSignal(item.type, item.payload);
          }
        } catch {/**/}
      }, 1200);
    };

    boot().catch(() => doEnd());
    return () => {
      document.body.style.overflow = '';
      document.body.style.position = '';
      document.body.style.width    = '';
      doEnd();
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const fmt = (s: number) =>
    `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;

  const toggleMic = () => {
    stateRef.current.stream?.getAudioTracks().forEach(t => { t.enabled = !micOn; });
    setMicOn(v => !v);
  };

  // Громкий/тихий — переключение через setSinkId (earpiece vs speaker)
  const toggleSpeaker = async () => {
    const audio = remoteAudio.current as HTMLAudioElement & { setSinkId?: (id: string) => Promise<void> };
    if (audio?.setSinkId) {
      try {
        await audio.setSinkId(speakerOn ? 'default' : '');
      } catch {/**/}
    }
    setSpeakerOn(v => !v);
  };

  // Переключение камеры фронт/тыл
  const flipCamera = async () => {
    const s = stateRef.current;
    const pc = s.pc;
    const newFacing = facingMode === 'user' ? 'environment' : 'user';
    try {
      const newStream = await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: { facingMode: newFacing, width: { ideal: 1280 }, height: { ideal: 720 } },
      });
      const newVideoTrack = newStream.getVideoTracks()[0];
      // Заменяем трек в PeerConnection
      if (pc) {
        const sender = pc.getSenders().find(s => s.track?.kind === 'video');
        if (sender) await sender.replaceTrack(newVideoTrack);
      }
      // Останавливаем старый видеотрек
      s.stream?.getVideoTracks().forEach(t => t.stop());
      // Обновляем stream для localRef
      const audioTrack = s.stream?.getAudioTracks()[0];
      const combined = new MediaStream([newVideoTrack, ...(audioTrack ? [audioTrack] : [])]);
      s.stream = combined;
      if (localRef.current) { localRef.current.srcObject = combined; localRef.current.muted = true; }
      setFacingMode(newFacing);
    } catch (e) { console.error('[WebRTC] flip camera error:', e); }
  };

  const toggleCam = () => {
    stateRef.current.stream?.getVideoTracks().forEach(t => { t.enabled = !camOn; });
    setCamOn(v => !v);
  };
  const hangup = () => { sig('end', {}); doEnd(); };

  // ── Мини-чат поверх звонка ──────────────────────────────────────────────
  const [showChat, setShowChat] = useState(false);
  const [chatId, setChatId] = useState<number | null>(null);
  const [chatMsgs, setChatMsgs] = useState<Message[]>([]);
  const [chatInput, setChatInput] = useState('');
  const chatLastId = useRef(0);
  const chatScrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!showChat) return;
    let cancelled = false;
    const init = async () => {
      const d = await api('open_chat', 'POST', { user_id: user.id, peer_id: peer.id });
      if (cancelled) return;
      const cid = d.chat_id as number;
      setChatId(cid);
      const hist = await api(`messages&chat_id=${cid}&user_id=${user.id}`);
      if (cancelled) return;
      const msgs = (hist.messages as Message[]) || [];
      setChatMsgs(msgs);
      if (msgs.length) chatLastId.current = msgs[msgs.length - 1].id;
      setTimeout(() => { chatScrollRef.current && (chatScrollRef.current.scrollTop = chatScrollRef.current.scrollHeight); }, 50);
    };
    init();
    const iv = setInterval(async () => {
      if (!chatId) return;
      const d = await api(`chat_poll&chat_id=${chatId}&after=${chatLastId.current}&user_id=${user.id}&peer_id=${peer.id}`);
      const fresh = (d.messages as Message[]) || [];
      if (fresh.length) {
        chatLastId.current = fresh[fresh.length - 1].id;
        setChatMsgs(m => [...m, ...fresh]);
        setTimeout(() => { chatScrollRef.current && (chatScrollRef.current.scrollTop = chatScrollRef.current.scrollHeight); }, 50);
      }
    }, 1500);
    return () => { cancelled = true; clearInterval(iv); };
  }, [showChat]); // eslint-disable-line react-hooks/exhaustive-deps

  const sendChatMsg = async () => {
    const txt = chatInput.trim();
    if (!txt || !chatId) return;
    setChatInput('');
    const d = await api('send', 'POST', { chat_id: chatId, user_id: user.id, text: txt });
    const real = d.message as Message | undefined;
    if (real) {
      chatLastId.current = Math.max(chatLastId.current, real.id);
      setChatMsgs(m => [...m, { ...real, sender_nick: user.nick }]);
      setTimeout(() => { chatScrollRef.current && (chatScrollRef.current.scrollTop = chatScrollRef.current.scrollHeight); }, 50);
    }
  };

  // Своё видео: зеркало только для фронталки
  const localMirror = facingMode === 'user' ? 'scaleX(-1)' : 'none';

  // Перетаскивание маленького видео
  const [pipPos, setPipPos] = useState({ x: -1, y: -1 }); // -1 = дефолт (правый нижний угол)
  const pipDrag = useRef<{ startX: number; startY: number; ox: number; oy: number; moved: boolean } | null>(null);

  const onPipTouchStart = (e: React.TouchEvent) => {
    e.stopPropagation();
    const tp = e.touches[0];
    const ox = pipPos.x === -1 ? window.innerWidth - 136 : pipPos.x;
    const oy = pipPos.y === -1 ? window.innerHeight - 285 : pipPos.y;
    pipDrag.current = { startX: tp.clientX, startY: tp.clientY, ox, oy, moved: false };
  };
  const onPipTouchMove = (e: React.TouchEvent) => {
    if (!pipDrag.current) return;
    e.stopPropagation();
    const tp = e.touches[0];
    const dx = tp.clientX - pipDrag.current.startX;
    const dy = tp.clientY - pipDrag.current.startY;
    if (Math.abs(dx) > 5 || Math.abs(dy) > 5) pipDrag.current.moved = true;
    const newX = Math.max(8, Math.min(window.innerWidth - 128, pipDrag.current.ox + dx));
    const newY = Math.max(8, Math.min(window.innerHeight - 185, pipDrag.current.oy + dy));
    setPipPos({ x: newX, y: newY });
  };
  const onPipTouchEnd = (e: React.TouchEvent) => {
    e.stopPropagation();
    // Тап без движения — увеличить своё видео на весь экран
    if (pipDrag.current && !pipDrag.current.moved) {
      setSelfBig(v => !v);
    }
    pipDrag.current = null;
  };

  const pipStyle: React.CSSProperties = pipPos.x === -1
    ? { bottom: 120, right: 16 }
    : { top: pipPos.y, left: pipPos.x };

  return (
    <div className="fixed inset-0 z-50 bg-black flex flex-col" style={{ touchAction: 'none' }}>
      <audio ref={remoteAudio} autoPlay playsInline style={{ position: 'absolute', width: 0, height: 0 }} />

      {kind === 'video' ? (
        <div className="relative flex-1 overflow-hidden bg-black">
          {/* ── Оба video всегда в DOM — только CSS меняет кто большой ── */}

          {/* Видео собеседника */}
          <video ref={remoteRef} autoPlay playsInline
            style={{ position: 'absolute', inset: 0, width: '100%', height: '100%',
              objectFit: 'cover', display: 'block',
              zIndex: selfBig ? 1 : 2 }} />

          {/* Моё видео — большое если selfBig, иначе PiP */}
          <div
            onTouchStart={onPipTouchStart}
            onTouchMove={onPipTouchMove}
            onTouchEnd={onPipTouchEnd}
            style={selfBig ? {
              position: 'absolute', inset: 0, zIndex: 3, touchAction: 'none'
            } : {
              position: 'absolute', ...pipStyle, zIndex: 30,
              width: 120, height: 165, borderRadius: 18, overflow: 'hidden',
              border: '2.5px solid rgba(255,255,255,0.3)',
              boxShadow: '0 8px 32px rgba(0,0,0,0.6)', touchAction: 'none',
              transition: 'border-radius 0.3s, box-shadow 0.2s'
            }}>
            <video ref={localRef} autoPlay playsInline muted
              style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block',
                transform: localMirror, borderRadius: selfBig ? 0 : 16 }} />
            {/* Подсказка внизу PiP */}
            {!selfBig && (
              <div style={{ position: 'absolute', bottom: 0, left: 0, right: 0,
                background: 'linear-gradient(transparent, rgba(0,0,0,0.5))',
                padding: '12px 4px 4px', textAlign: 'center', pointerEvents: 'none' }}>
                <span style={{ fontSize: 9, color: 'rgba(255,255,255,0.7)' }}>{t('я')}</span>
              </div>
            )}
            {/* Кнопка flip камеры внутри selfBig */}
            {selfBig && (
              <button onClick={e => { e.stopPropagation(); flipCamera(); }}
                style={{ position: 'absolute', top: 'calc(env(safe-area-inset-top) + 12px)', right: 14,
                  width: 46, height: 46, borderRadius: '50%', background: 'rgba(60,60,60,0.85)',
                  border: 'none', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 5 }}>
                <Icon name="RefreshCw" size={20} className="text-white" />
              </button>
            )}
          </div>

          {/* Заголовок — всегда поверх */}
          <div style={{ position: 'absolute', top: 0, left: 0, right: 0, zIndex: 20,
            paddingTop: 'calc(env(safe-area-inset-top) + 12px)',
            paddingBottom: 8, paddingLeft: 60, paddingRight: 60,
            background: 'linear-gradient(to bottom, rgba(0,0,0,0.55) 0%, transparent 100%)',
            textAlign: 'center', pointerEvents: 'none' }}>
            <p style={{ color: '#fff', fontWeight: 700, fontSize: 18, margin: 0 }}>{peer.nick}</p>
            <p style={{ color: 'rgba(255,255,255,0.7)', fontSize: 13, margin: '2px 0 0' }}>
              {status === 'active' ? fmt(duration) : outgoing ? t('Звонок...') : t('Соединение...')}
            </p>
          </div>

          {/* Кнопка flip когда собеседник большой */}
          {!selfBig && (
            <button onClick={flipCamera}
              style={{ position: 'absolute', top: 'calc(env(safe-area-inset-top) + 12px)', right: 14, zIndex: 20,
                width: 46, height: 46, borderRadius: '50%', background: 'rgba(60,60,60,0.85)',
                border: 'none', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <Icon name="RefreshCw" size={20} className="text-white" />
            </button>
          )}

          {/* Оверлей ожидания */}
          {status !== 'active' && (
            <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column',
              alignItems: 'center', justifyContent: 'center', background: 'rgba(0,0,0,0.7)', zIndex: 25 }}>
              <div className="relative mb-5">
                <span className="absolute inset-0 rounded-full bg-primary/40 animate-pulse-ring" />
                <Avatar url={peer.avatar_url} nick={peer.nick} size={96} />
              </div>
              <p className="text-white font-bold text-xl mb-1">@{peer.nick}</p>
              <p className="text-white/50 text-sm">{outgoing ? t('Вызов...') : t('Соединяемся...')}</p>
            </div>
          )}
        </div>
      ) : (
        /* Аудио звонок */
        <div className="flex-1 flex flex-col items-center justify-center" style={{ background: 'linear-gradient(160deg,#0d0d1a,#1a0d2e)' }}>
          <div className="relative mb-6">
            <span className="absolute inset-0 rounded-full bg-primary/30 animate-pulse-ring" />
            <Avatar url={peer.avatar_url} nick={peer.nick} size={112} />
          </div>
          <p className="text-white font-bold text-2xl mb-2">@{peer.nick}</p>
          <p className={`text-sm ${status === 'active' ? 'text-green-400' : 'text-white/50'}`}>
            {status === 'active' ? `● ${fmt(duration)}` : outgoing ? t('Вызов...') : t('Соединяемся...')}
          </p>
        </div>
      )}

      {/* Панель кнопок — капсула как WhatsApp */}
      <div style={{
        position: 'absolute', bottom: 0, left: 0, right: 0, zIndex: 40,
        paddingBottom: 'calc(env(safe-area-inset-bottom) + 24px)',
        paddingTop: 16, paddingLeft: 16, paddingRight: 16,
        background: kind === 'video' ? 'transparent' : 'rgba(0,0,0,0.88)',
        display: 'flex', justifyContent: 'center',
      }}>
        <div style={{
          display: 'flex', alignItems: 'center', gap: 10,
          background: 'rgba(40,40,40,0.82)', backdropFilter: 'blur(20px)',
          borderRadius: 60, padding: '10px 18px',
          boxShadow: '0 4px 30px rgba(0,0,0,0.5)',
        }}>
          {/* Чат поверх звонка */}
          <button onClick={() => setShowChat(true)}
            style={{ width: 50, height: 50, borderRadius: '50%', background: 'rgba(80,80,80,0.7)',
              border: 'none', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <Icon name="MessageCircle" size={22} className="text-white" />
          </button>

          {/* Камера (видео вкл/выкл) */}
          {kind === 'video' && (
            <button onClick={toggleCam}
              style={{ width: 50, height: 50, borderRadius: '50%', border: 'none', display: 'flex', alignItems: 'center', justifyContent: 'center',
                background: camOn ? 'rgba(255,255,255,0.92)' : 'rgba(80,80,80,0.7)' }}>
              <Icon name={camOn ? 'Video' : 'VideoOff'} size={22} style={{ color: camOn ? '#111' : '#fff' }} />
            </button>
          )}

          {/* Динамик */}
          <button onClick={toggleSpeaker}
            style={{ width: 50, height: 50, borderRadius: '50%', border: 'none', display: 'flex', alignItems: 'center', justifyContent: 'center',
              background: speakerOn ? 'rgba(255,255,255,0.92)' : 'rgba(80,80,80,0.7)' }}>
            <Icon name={speakerOn ? 'Volume2' : 'VolumeX'} size={22} style={{ color: speakerOn ? '#111' : '#fff' }} />
          </button>

          {/* Микрофон */}
          <button onClick={toggleMic}
            style={{ width: 50, height: 50, borderRadius: '50%', border: 'none', display: 'flex', alignItems: 'center', justifyContent: 'center',
              background: micOn ? 'rgba(80,80,80,0.7)' : 'rgba(220,38,38,0.85)' }}>
            <Icon name={micOn ? 'Mic' : 'MicOff'} size={22} className="text-white" />
          </button>

          {/* Завершить */}
          <button onClick={hangup}
            style={{ width: 58, height: 58, borderRadius: '50%', border: 'none', display: 'flex', alignItems: 'center', justifyContent: 'center',
              background: '#dc2626', boxShadow: '0 4px 20px rgba(220,38,38,0.5)' }}>
            <Icon name="PhoneOff" size={24} className="text-white" />
          </button>
        </div>
      </div>

      {/* Оверлей чата поверх звонка — не прерывает разговор */}
      {showChat && (
        <div className="fixed inset-0 z-[60] flex flex-col animate-fade-up" style={{ background: 'rgba(15,15,20,0.97)' }}>
          <div className="shrink-0 flex items-center gap-3 px-4 bg-blue-600"
            style={{ paddingTop: 'calc(env(safe-area-inset-top) + 12px)', paddingBottom: 12 }}>
            <button onClick={() => setShowChat(false)} className="w-9 h-9 rounded-full hover:bg-white/15 flex items-center justify-center">
              <Icon name="ChevronDown" size={22} className="text-white" />
            </button>
            <Avatar url={peer.avatar_url} nick={peer.nick} size={36} />
            <div className="flex-1 min-w-0">
              <p className="text-white font-bold text-[15px] truncate">@{peer.nick}</p>
              <p className="text-blue-200 text-[11px]">{status === 'active' ? fmt(duration) : t('Звонок...')}</p>
            </div>
            <Icon name={kind === 'video' ? 'Video' : 'Phone'} size={18} className="text-white/70" />
          </div>

          <div ref={chatScrollRef} className="flex-1 overflow-y-auto px-3 py-3 space-y-2">
            {chatMsgs.map(m => {
              const mine = m.sender_id === user.id;
              return (
                <div key={m.id} className={`flex ${mine ? 'justify-end' : 'justify-start'}`}>
                  <div className={`max-w-[75%] px-3.5 py-2 rounded-2xl text-[14.5px] ${mine ? 'bg-blue-600 text-white rounded-br-md' : 'bg-white/10 text-white rounded-bl-md'}`}>
                    {m.text}
                  </div>
                </div>
              );
            })}
          </div>

          <div className="shrink-0 flex items-center gap-2 px-3 py-3" style={{ paddingBottom: 'calc(env(safe-area-inset-bottom) + 12px)' }}>
            <div className="flex-1 flex items-center bg-white/10 rounded-full px-4">
              <input value={chatInput} onChange={e => setChatInput(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && sendChatMsg()}
                placeholder={t('Сообщение')}
                className="flex-1 bg-transparent outline-none py-2.5 text-sm text-white placeholder:text-white/40" />
            </div>
            <button onClick={sendChatMsg} disabled={!chatInput.trim()}
              className="w-10 h-10 shrink-0 rounded-full bg-blue-600 flex items-center justify-center disabled:opacity-40 transition-opacity">
              <Icon name="Send" size={18} className="text-white" />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// ── INCOMING CALL BANNER — полноэкранный, как в WhatsApp ─────────────────────
function IncomingCallBanner({ caller, kind, onAccept, onReject }: {
  caller: { nick: string; avatar_url?: string | null }; kind: string;
  onAccept: () => void; onReject: () => void;
}) {
  const { t } = useLang();
  return (
    <div className="fixed inset-0 z-50 flex flex-col animate-fade-up"
      style={{ background: 'linear-gradient(160deg, #1a2a52 0%, #0d1226 60%, #060810 100%)' }}>
      {/* Верхняя часть — аватар и имя */}
      <div className="flex-1 flex flex-col items-center justify-center px-6"
        style={{ paddingTop: 'env(safe-area-inset-top)' }}>
        <p className="text-white/60 text-[13px] font-medium tracking-wide mb-8 uppercase">
          {kind === 'video' ? t('Входящий видеозвонок') : t('Входящий звонок')}
        </p>
        <div className="relative mb-6">
          <span className="absolute -inset-4 rounded-full bg-green-400/20 animate-pulse-ring" />
          <span className="absolute -inset-8 rounded-full bg-green-400/10 animate-pulse-ring" style={{ animationDelay: '0.3s' }} />
          <Avatar url={caller.avatar_url} nick={caller.nick} size={128} />
        </div>
        <p className="text-white font-bold text-[26px] tracking-tight">@{caller.nick}</p>
        <p className="text-white/50 text-sm mt-2 flex items-center gap-1.5">
          <Icon name={kind === 'video' ? 'Video' : 'Phone'} size={14} className="text-white/50" />
          {kind === 'video' ? t('видеозвонок') : t('аудиозвонок')}
        </p>
      </div>

      {/* Кнопки приёма/отклонения — большие, полупрозрачные */}
      <div className="flex items-center justify-center gap-16 px-6"
        style={{ paddingBottom: 'calc(env(safe-area-inset-bottom) + 56px)' }}>
        <div className="flex flex-col items-center gap-3">
          <button onClick={onReject}
            className="w-[68px] h-[68px] rounded-full flex items-center justify-center transition-transform active:scale-90"
            style={{ background: 'rgba(220,38,38,0.9)', boxShadow: '0 6px 24px rgba(220,38,38,0.45)' }}>
            <Icon name="PhoneOff" size={28} className="text-white" />
          </button>
          <span className="text-white/70 text-[13px] font-medium">{t('Отклонить')}</span>
        </div>
        <div className="flex flex-col items-center gap-3">
          <button onClick={onAccept}
            className="w-[68px] h-[68px] rounded-full flex items-center justify-center transition-transform active:scale-90 animate-pulse-ring-btn"
            style={{ background: 'rgba(34,197,94,0.92)', boxShadow: '0 6px 24px rgba(34,197,94,0.45)' }}>
            <Icon name={kind === 'video' ? 'Video' : 'Phone'} size={28} className="text-white" />
          </button>
          <span className="text-white/70 text-[13px] font-medium">{t('Принять')}</span>
        </div>
      </div>
    </div>
  );
}

// ── Сжатие изображений перед загрузкой ────────────────────────────────────
function compressImage(file: File, maxSize = 1200, quality = 0.82): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = reject;
    reader.onload = () => {
      const img = new Image();
      img.onerror = reject;
      img.onload = () => {
        // Вычисляем новый размер с сохранением пропорций
        let { width, height } = img;
        if (width > maxSize || height > maxSize) {
          if (width > height) { height = Math.round(height * maxSize / width); width = maxSize; }
          else { width = Math.round(width * maxSize / height); height = maxSize; }
        }
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        if (!ctx) { reject(new Error('no ctx')); return; }
        ctx.drawImage(img, 0, 0, width, height);
        resolve(canvas.toDataURL('image/jpeg', quality));
      };
      img.src = reader.result as string;
    };
    reader.readAsDataURL(file);
  });
}

// ── VOICE PLAYER ─────────────────────────────────────────────────────────────
function VoicePlayer({ src, mine }: { src: string; mine: boolean }) {
  const audioRef = useRef<HTMLAudioElement>(null);
  const [playing, setPlaying] = useState(false);
  const [progress, setProgress] = useState(0);
  const [duration, setDuration] = useState(0);
  const [speed, setSpeed] = useState(1);
  const speeds = [1, 1.5, 2];

  const toggle = () => {
    const a = audioRef.current; if (!a) return;
    if (playing) { a.pause(); setPlaying(false); }
    else { a.play(); setPlaying(true); }
  };
  const cycleSpeed = () => {
    const a = audioRef.current; if (!a) return;
    const next = speeds[(speeds.indexOf(speed) + 1) % speeds.length];
    setSpeed(next); a.playbackRate = next;
  };
  const seek = (e: React.ChangeEvent<HTMLInputElement>) => {
    const a = audioRef.current; if (!a) return;
    a.currentTime = Number(e.target.value);
    setProgress(Number(e.target.value));
  };
  const fmt = (s: number) => `${String(Math.floor(s / 60)).padStart(2,'0')}:${String(Math.floor(s % 60)).padStart(2,'0')}`;
  const pct = duration > 0 ? (progress / duration) * 100 : 0;

  // Волны — 5 столбиков, анимируются только во время воспроизведения
  const bars = [0.4, 0.75, 1, 0.65, 0.45];

  return (
    <div className="flex items-center gap-2.5 py-0.5 min-w-[210px] max-w-[250px]">
      <audio ref={audioRef} src={src} preload="metadata"
        onTimeUpdate={e => setProgress((e.target as HTMLAudioElement).currentTime)}
        onLoadedMetadata={e => setDuration((e.target as HTMLAudioElement).duration)}
        onEnded={() => { setPlaying(false); setProgress(0); if (audioRef.current) audioRef.current.currentTime = 0; }}
      />
      {/* Кнопка play/pause */}
      <button onClick={toggle}
        className={`w-9 h-9 shrink-0 rounded-full flex items-center justify-center shadow-sm
          ${mine ? 'bg-white/25 hover:bg-white/35' : 'bg-primary/15 hover:bg-primary/25'}`}>
        <Icon name={playing ? 'Pause' : 'Play'} size={17} className={mine ? 'text-white' : 'text-primary'} />
      </button>

      <div className="flex-1 flex flex-col gap-1.5">
        {/* Волны + прогресс */}
        <div className="relative flex items-center gap-0.5 h-6">
          {/* Волны */}
          <div className="flex items-center gap-[3px] w-full h-full">
            {bars.map((h, i) => (
              <div key={i}
                className="rounded-full flex-1"
                style={{
                  height: `${h * 100}%`,
                  background: mine
                    ? `rgba(255,255,255,${playing ? 0.9 : 0.4})`
                    : `hsl(var(--primary) / ${playing ? 0.85 : 0.35})`,
                  transform: playing ? undefined : 'scaleY(1)',
                  animation: playing ? `voiceWave ${0.6 + i * 0.12}s ease-in-out infinite alternate` : 'none',
                  transition: 'background 0.3s ease',
                }}
              />
            ))}
          </div>
          {/* Прогресс-бар поверх волн */}
          <input type="range" min={0} max={duration || 1} step={0.1} value={progress} onChange={seek}
            className="absolute inset-0 w-full opacity-0 cursor-pointer h-full"
          />
        </div>

        {/* Время + скорость */}
        <div className="flex items-center justify-between">
          <span className={`text-[10px] tabular-nums ${mine ? 'text-white/55' : 'text-muted-foreground'}`}>
            {fmt(progress)} / {fmt(duration)}
          </span>
          <button onClick={cycleSpeed}
            className={`text-[10px] font-bold px-1.5 py-0.5 rounded-full
              ${mine ? 'bg-white/20 text-white' : 'bg-primary/10 text-primary'}`}>
            {speed}×
          </button>
        </div>
      </div>
    </div>
  );
}

// ── RENDER TEXT WITH LINKS ────────────────────────────────────────────────────
function renderTextWithLinks(text: string, mine: boolean) {
  const urlRegex = new RegExp('(https?:\\/\\/[^\\s]+)', 'g');
  const parts = text.split(urlRegex);
  return parts.map((part, i) =>
    new RegExp('^https?:\\/\\/[^\\s]+$').test(part)
      ? <a key={i} href={part} target="_blank" rel="noopener noreferrer"
          className={`underline underline-offset-2 break-all ${mine ? 'text-white/90' : 'text-blue-600'}`}
          onClick={e => e.stopPropagation()}>{part}</a>
      : <span key={i}>{part}</span>
  );
}

// ── MEDIA VIEWER ─────────────────────────────────────────────────────────────
function MediaViewer({ src, type, onClose }: { src: string; type: 'image' | 'video'; onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-[100] bg-black flex items-center justify-center"
      onClick={onClose}>
      <button className="absolute right-4 w-10 h-10 rounded-full bg-white/20 flex items-center justify-center z-10"
        style={{ top: 'calc(env(safe-area-inset-top) + 12px)' }}
        onClick={onClose}>
        <Icon name="X" size={22} className="text-white" />
      </button>
      {type === 'image'
        ? <img src={src} alt="" className="max-w-full max-h-full object-contain" onClick={e => e.stopPropagation()} />
        : <video src={src} controls autoPlay className="max-w-full max-h-full" onClick={e => e.stopPropagation()} />
      }
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════════════
const EMOJIS = ['❤️','😂','😮','😢','👍','👎','🔥','🎉','😍','🤔'];
const COMPOSER_EMOJIS = ['😀','😂','😍','🥰','😊','😉','😎','🤔','😢','😭','😡','👍','👎','👏','🙏','🔥','❤️','💯','🎉','😴'];

type Reaction = { emoji: string; user_id: number };
type MsgExt = Message & { reactions?: Reaction[]; is_removed?: boolean; media_type?: string; media_url?: string };

function ChatScreen({ user, chatId, peer, groupName, groupId, groupPhotoUrl, onBack, onOpenProfile, onOpenGroup, autoCall, onCallStarted }: {
  user: User; chatId: number; peer?: User; groupName?: string; groupId?: number; groupPhotoUrl?: string | null;
  onBack: () => void; onOpenProfile: (id: number) => void; onOpenGroup: (gid: number, chatId: number) => void;
  autoCall?: { kind: 'audio' | 'video' } | null;
  onCallStarted?: () => void;
}) {
  const { t } = useLang();
  const [messages, setMessages] = useState<MsgExt[]>([]);
  const [input, setInput] = useState('');
  const [typing, setTyping] = useState<string[]>([]);
  const [peerOnline, setPeerOnline] = useState(false);
  const [peerLastSeen, setPeerLastSeen] = useState<string | null>(null);
  const [selectedMsg, setSelectedMsg] = useState<number | null>(null);
  const [emojiTarget, setEmojiTarget] = useState<number | null>(null);
  const [showAttach, setShowAttach] = useState(false);
  const [showComposerEmoji, setShowComposerEmoji] = useState(false);
  const [recording, setRecording] = useState(false);
  const [recordSecs, setRecordSecs] = useState(0);
  const [inCall, setInCall] = useState<{ kind: 'audio' | 'video'; callId: string; outgoing: boolean } | null>(null);
  const [mediaView, setMediaView] = useState<{ src: string; type: 'image' | 'video' } | null>(null);
  const [forwardMsg, setForwardMsg] = useState<MsgExt | null>(null);
  const [forwardChats, setForwardChats] = useState<ChatItem[]>([]);
  const [showForward, setShowForward] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState('');
  const [readByMsg, setReadByMsg] = useState<{ msgId: number; readers: { id: number; nick: string; avatar_url?: string | null }[] } | null>(null);
  const lastIdRef = useRef(0);
  const endRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLElement>(null);
  const isAtBottomRef = useRef(true);
  const typingTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mediaRec = useRef<MediaRecorder | null>(null);
  const audioChunks = useRef<Blob[]>([]);
  const fileRef = useRef<HTMLInputElement>(null);
  const fileRef2 = useRef<HTMLInputElement>(null);
  const fileType = useRef<'image' | 'audio'>('image');
  const recordTimer = useRef<ReturnType<typeof setInterval> | null>(null);
  const cancelFlag = useRef(false);

  const poll = useCallback(async () => {
    const d = await api(`chat_poll&chat_id=${chatId}&after=${lastIdRef.current}&user_id=${user.id}&peer_id=${peer?.id || 0}`);
    const fresh: MsgExt[] = d.messages || [];
    if (fresh.length) {
      lastIdRef.current = fresh[fresh.length - 1].id;
      setMessages(m => {
        const existingIds = new Set(m.filter(x => x.id > 0).map(x => x.id));
        const toAdd = fresh.filter(f => !existingIds.has(f.id));
        return [...m, ...toAdd];
      });
    }
    if (d.read_until) {
      const ru = d.read_until as number;
      setMessages(m => m.map(msg => msg.sender_id === user.id && msg.id <= ru ? { ...msg, is_read: true } : msg));
    }
    setTyping(d.typing || []);
    if (peer) {
      setPeerOnline(d.peer_online || false);
      if (d.peer_last_seen) setPeerLastSeen(d.peer_last_seen as string);
    }
    // Применяем обновления: удаления у всех + реакции
    const updates = d.updates as { id: number; is_removed: boolean; reactions: Reaction[] }[] || [];
    if (updates.length) {
      setMessages(ms => ms.map(m => {
        const upd = updates.find(u => u.id === m.id);
        if (!upd) return m;
        return { ...m, is_removed: upd.is_removed, reactions: upd.reactions };
      }));
    }
  }, [chatId, user.id, peer]);

  useEffect(() => {
    let active = true;
    const loop = async () => {
      while (active) {
        if (!document.hidden) {
          await poll();
          await new Promise(r => setTimeout(r, 800));
        } else {
          await new Promise(r => setTimeout(r, 3000));
        }
      }
    };
    loop();
    const onVisible = () => { if (!document.hidden) poll(); };
    document.addEventListener('visibilitychange', onVisible);
    return () => { active = false; document.removeEventListener('visibilitychange', onVisible); };
  }, [poll]);

  // При первом открытии чата — прыгаем вниз мгновенно и помечаем "внизу"
  useEffect(() => {
    isAtBottomRef.current = true;
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [chatId]);

  // При новых сообщениях — скроллим только если пользователь УЖЕ внизу
  // Если листает вверх — НЕ трогаем позицию
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    if (isAtBottomRef.current) {
      el.scrollTop = el.scrollHeight;
    }
    // Если отправил сам — скроллим вниз только после отправки (через send)
  }, [messages]);

  // Автозвонок при открытии чата из профиля
  useEffect(() => {
    if (!autoCall || !peer) return;
    const cid = `${user.id}_${peer.id}_${Date.now()}`;
    setInCall({ kind: autoCall.kind, callId: cid, outgoing: true });
    onCallStarted?.();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const handleInput = (v: string) => {
    setInput(v);
    api('typing', 'POST', { chat_id: chatId, user_id: user.id, typing: true });
    if (typingTimer.current) clearTimeout(typingTimer.current);
    typingTimer.current = setTimeout(() => api('typing', 'POST', { chat_id: chatId, user_id: user.id, typing: false }), 3000);
  };

  const send = async (text?: string, media_url?: string, media_type?: string) => {
    const txt = text ?? input.trim();
    if (!txt && !media_url) return;
    if (!text) setInput('');
    if (typingTimer.current) clearTimeout(typingTimer.current);
    playSendSound();

    // Optimistic update — сообщение появляется в чате мгновенно, не дожидаясь сервера
    const tempId = -Date.now();
    const optimisticMsg: MsgExt = {
      id: tempId,
      sender_id: user.id,
      sender_nick: user.nick,
      sender_avatar: user.avatar_url,
      sender_verified: user.is_verified,
      text: txt || null,
      media_url: media_url || null,
      media_type: media_type || null,
      created_at: new Date().toISOString(),
      is_read: false,
    };
    setMessages(m => [...m, optimisticMsg]);
    isAtBottomRef.current = true;
    setTimeout(() => {
      const el = scrollRef.current;
      if (el) el.scrollTop = el.scrollHeight;
    }, 0);

    const d = await api('send', 'POST', { chat_id: chatId, user_id: user.id, text: txt || null, media_url: media_url || null, media_type: media_type || null });
    const real = d.message as MsgExt | undefined;
    if (real) {
      lastIdRef.current = Math.max(lastIdRef.current, real.id);
      setMessages(m => {
        // Если polling уже успел подтянуть это же сообщение — просто убираем "черновик"
        if (m.some(msg => msg.id === real.id)) return m.filter(msg => msg.id !== tempId);
        return m.map(msg => msg.id === tempId ? { ...real, sender_nick: user.nick, sender_avatar: user.avatar_url, sender_verified: user.is_verified } : msg);
      });
    } else {
      // Отправка не удалась — убираем оптимистичное сообщение
      setMessages(m => m.filter(msg => msg.id !== tempId));
    }
  };

  const openForward = async (msg: MsgExt) => {
    setForwardMsg(msg);
    const d = await api(`chats&user_id=${user.id}`);
    setForwardChats(d.chats || []);
    setShowForward(true);
  };

  const doForward = async (targetChatId: number) => {
    if (!forwardMsg) return;
    await api('send', 'POST', {
      chat_id: targetChatId,
      user_id: user.id,
      text: forwardMsg.text || null,
      media_url: forwardMsg.media_url || forwardMsg.image_url || null,
      media_type: forwardMsg.media_type || (forwardMsg.image_url ? 'image' : null),
    });
    setShowForward(false);
    setForwardMsg(null);
  };

  const uploadFile = async (file: File, type: 'image' | 'audio' | 'voice') => {
    const maxMb = type === 'audio' ? 100 : 20;
    if (file.size > maxMb * 1024 * 1024) {
      alert(`${t('Файл слишком большой. Максимум')} ${maxMb} ${t('МБ.')}`);
      return;
    }
    setUploading(true);
    try {
      const ext = (file.name.split('.').pop() || (type === 'voice' ? 'ogg' : type === 'image' ? 'jpg' : type)).toLowerCase();
      setUploadProgress(type === 'image' ? 'Загрузка фото...' : 'Загрузка...');
      const b64 = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve((reader.result as string).split(',')[1]);
        reader.onerror = reject;
        reader.readAsDataURL(file);
      });
      const d = await api('upload_media', 'POST', { user_id: user.id, data: b64, ext, media_type: type });
      if (d.url) await send(undefined, d.url, type);
    } catch (e) {
      console.error('[uploadFile]', e);
      alert(`${t('Ошибка')}: ${e}`);
    } finally {
      setUploading(false);
      setUploadProgress('');
    }
  };

  const pickFile = (type: 'image' | 'audio') => {
    fileType.current = type;
    setShowAttach(false);
    if (fileRef.current) {
      fileRef.current.accept = type === 'image' ? 'image/*' : 'audio/*';
      fileRef.current.click();
    }
  };

  const startVoice = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const rec = new MediaRecorder(stream);
      audioChunks.current = [];
      cancelFlag.current = false;
      rec.ondataavailable = e => audioChunks.current.push(e.data);
      rec.onstop = async () => {
        stream.getTracks().forEach(t => t.stop());
        if (cancelFlag.current) return;
        const blob = new Blob(audioChunks.current, { type: 'audio/ogg' });
        await uploadFile(new File([blob], 'voice.ogg'), 'voice');
      };
      rec.start();
      mediaRec.current = rec;
      setRecording(true);
      setRecordSecs(0);
      recordTimer.current = setInterval(() => setRecordSecs(s => s + 1), 1000);
    } catch { /* нет микрофона */ }
  };

  const stopVoice = () => {
    if (!mediaRec.current || !recording) return;
    if (recordTimer.current) { clearInterval(recordTimer.current); recordTimer.current = null; }
    mediaRec.current.stop();
    setRecording(false);
    setRecordSecs(0);
  };

  const cancelVoice = () => {
    cancelFlag.current = true;
    if (recordTimer.current) { clearInterval(recordTimer.current); recordTimer.current = null; }
    mediaRec.current?.stop();
    setRecording(false);
    setRecordSecs(0);
  };

  const react = async (msgId: number, emoji: string) => {
    setEmojiTarget(null);
    const d = await api('react', 'POST', { message_id: msgId, user_id: user.id, emoji });
    setMessages(ms => ms.map(m => m.id === msgId ? { ...m, reactions: d.reactions } : m));
  };

  const deleteMsg = async (msgId: number, forAll: boolean) => {
    setSelectedMsg(null);
    await api('delete_message', 'POST', { message_id: msgId, user_id: user.id, for_all: forAll });
    if (forAll) setMessages(ms => ms.map(m => m.id === msgId ? { ...m, is_removed: true, text: null } : m));
    else setMessages(ms => ms.filter(m => m.id !== msgId));
  };

  const title = groupName || (peer ? `@${peer.nick}` : '');
  const subtitle = typing.length > 0
    ? null  // рендерим анимацию отдельно
    : groupName ? t('Группа')
    : peerOnline ? t('в сети')
    : peerLastSeen ? fmtLastSeen(peerLastSeen)
    : '';
  const subtitleColor = peerOnline && !groupName && typing.length === 0 ? 'text-green-300' : 'text-blue-200';

  return (
    <div className="fixed top-0 left-0 right-0 flex flex-col" style={{ height: 'var(--app-height, 100dvh)', backgroundColor: '#dbe4d3', backgroundImage: "url('https://cdn.poehali.dev/projects/59076a76-2862-4ba6-9c95-c02c43e87c88/bucket/2d1b9392-f223-4893-b9e1-bf82887796ab.jpg')", backgroundSize: 'cover', backgroundPosition: 'center', backgroundRepeat: 'no-repeat' }} onClick={() => { setSelectedMsg(null); setEmojiTarget(null); setShowAttach(false); setShowComposerEmoji(false); }}>
      {/* Header — Telegram стиль: скруглён снизу, тень */}
      <header className="shrink-0 flex items-center gap-1 px-1 bg-blue-600"
        style={{
          paddingTop: 'calc(env(safe-area-inset-top) + 6px)',
          paddingBottom: '12px',
          borderRadius: '0 0 18px 18px',
          boxShadow: '0 4px 20px rgba(37,99,235,0.35)',
          position: 'sticky',
          top: 0,
          zIndex: 10,
        }}
        onClick={e => e.stopPropagation()}>
        <button onClick={onBack} className="w-10 h-10 rounded-full hover:bg-white/15 flex items-center justify-center transition-colors shrink-0">
          <Icon name="ArrowLeft" size={22} className="text-white" />
        </button>
        <button className="flex items-center gap-2.5 flex-1 text-left min-w-0 active:opacity-70 transition-opacity"
          onClick={() => peer ? onOpenProfile(peer.id) : groupId && onOpenGroup(groupId, chatId)}>
          {peer
            ? <Avatar url={peer.avatar_url} nick={peer.nick} size={42} online={peerOnline} />
            : groupPhotoUrl
              ? <img src={groupPhotoUrl} className="w-[42px] h-[42px] rounded-full object-cover shrink-0" />
              : <div className="w-[42px] h-[42px] rounded-full bg-white/20 flex items-center justify-center shrink-0"><Icon name="Users" size={20} className="text-white" /></div>
          }
          <div className="min-w-0 flex-1">
            <div className="font-bold text-white text-[16px] truncate leading-tight flex items-center gap-1">
              <span className="truncate">{title}</span>
              {peer?.is_verified && <VerifiedBadge size={14} />}
            </div>
            {typing.length > 0
              ? <div className="flex items-center gap-1 mt-[2px]">
                  <span className="text-[12px] text-blue-200">{t('печатает')}</span>
                  <span className="flex gap-[3px] items-end pb-[1px]">
                    <span className="w-[3px] h-[3px] rounded-full bg-blue-200 animate-bounce" style={{ animationDelay: '0ms' }} />
                    <span className="w-[3px] h-[3px] rounded-full bg-blue-200 animate-bounce" style={{ animationDelay: '150ms' }} />
                    <span className="w-[3px] h-[3px] rounded-full bg-blue-200 animate-bounce" style={{ animationDelay: '300ms' }} />
                  </span>
                </div>
              : subtitle
                ? <div className={`text-[12px] truncate mt-[1px] ${subtitleColor}`}>{subtitle}</div>
                : null
            }
          </div>
        </button>
        {peer && <>
          <button onClick={() => { const cid = `${user.id}_${peer.id}_${Date.now()}`; setInCall({ kind: 'audio', callId: cid, outgoing: true }); }}
            className="w-10 h-10 rounded-full hover:bg-white/15 flex items-center justify-center transition-colors shrink-0">
            <Icon name="Phone" size={20} className="text-white" />
          </button>
          <button onClick={() => { const cid = `${user.id}_${peer.id}_${Date.now()}`; setInCall({ kind: 'video', callId: cid, outgoing: true }); }}
            className="w-10 h-10 rounded-full hover:bg-white/15 flex items-center justify-center transition-colors shrink-0">
            <Icon name="Video" size={20} className="text-white" />
          </button>
        </>}
      </header>

      {/* Messages — только эта область скроллится */}
      <main ref={scrollRef} className="flex-1 min-h-0 overflow-y-auto scrollbar-thin px-3 py-4 space-y-1"
        onScroll={() => {
          const el = scrollRef.current;
          if (!el) return;
          isAtBottomRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 60;
        }}>
        {messages.length === 0 && <p className="text-center text-muted-foreground text-sm mt-12">{t('Напишите первое сообщение')} 👋</p>}
        {messages.map((m, i) => {
          const mine = m.sender_id === user.id;
          const showNick = !mine && !!groupName && (i === 0 || messages[i - 1].sender_id !== m.sender_id);
          const reactions: Reaction[] = m.reactions || [];
          const grouped = reactions.reduce<Record<string, number>>((acc, r) => { acc[r.emoji] = (acc[r.emoji] || 0) + 1; return acc; }, {});
          const isSelected = selectedMsg === m.id;
          const showEmoji = emojiTarget === m.id;
          // Анимация только у последнего сообщения (только что пришло)
          const isLast = i === messages.length - 1;

          const touchStartX = { x: 0 };
          const handleTouchStart = (e: React.TouchEvent) => { touchStartX.x = e.touches[0].clientX; };
          const handleTouchEnd = (e: React.TouchEvent) => {
            const dx = touchStartX.x - e.changedTouches[0].clientX;
            if (mine && groupName && dx > 50) {
              api(`msg_read_by&message_id=${m.id}&chat_id=${chatId}&user_id=${user.id}`).then(d => {
                setReadByMsg({ msgId: m.id, readers: d.readers || [] });
              });
            }
          };

          return (
            <div key={m.id} className={`flex flex-col ${mine ? 'items-end' : 'items-start'} ${isLast ? (mine ? 'msg-out' : 'msg-in') : ''}`}
              onClick={e => { e.stopPropagation(); if (!m.is_removed) { setSelectedMsg(isSelected ? null : m.id); setEmojiTarget(null); } }}
              onTouchStart={handleTouchStart}
              onTouchEnd={handleTouchEnd}>
              {showNick && <span className="text-[11px] text-accent ml-10 mb-0.5 inline-flex items-center gap-0.5">{m.sender_nick}{m.sender_verified && <VerifiedBadge size={11} />}</span>}
              <div className={`flex items-end gap-1.5 ${mine ? 'flex-row-reverse' : ''} max-w-[82%]`}>
                {!mine && groupName && <Avatar url={m.sender_avatar} nick={m.sender_nick} size={34} />}
                <div className="relative">
                  <div className={`px-4 py-2.5 ${mine ? 'msg-bubble-mine' : 'msg-bubble-peer'} ${isSelected ? 'ring-2 ring-blue-400' : ''}`}>
                    {m.is_removed
                      ? <p className="text-xs italic opacity-60">{t('Сообщение удалено')}</p>
                      : m.media_type === 'image' || m.image_url
                        ? <img src={m.media_url || m.image_url || ''} alt=""
                            className="rounded-2xl max-h-60 max-w-full img-appear cursor-pointer"
                            loading="lazy"
                            onClick={e => { e.stopPropagation(); setMediaView({ src: m.media_url || m.image_url || '', type: 'image' }); }} />
                        : m.media_type === 'video'
                          ? <div onClick={e => { e.stopPropagation(); setMediaView({ src: m.media_url || '', type: 'video' }); }}
                              className="relative cursor-pointer">
                              <video src={m.media_url || ''} className="rounded-2xl max-h-48 max-w-full img-appear pointer-events-none" />
                              <div className="absolute inset-0 flex items-center justify-center">
                                <div className="w-12 h-12 rounded-full bg-black/50 flex items-center justify-center">
                                  <Icon name="Play" size={24} className="text-white ml-1" />
                                </div>
                              </div>
                            </div>
                          : (m.media_type === 'audio' || m.media_type === 'voice')
                            ? <VoicePlayer src={m.media_url || ''} mine={mine} />
                            : m.media_type === 'file'
                              ? <a href={m.media_url || ''} target="_blank" rel="noopener noreferrer"
                                  className={`flex items-center gap-2 py-0.5 ${mine ? 'text-white' : 'text-foreground'}`}>
                                  <Icon name="FileText" size={20} className={mine ? 'text-white/80' : 'text-accent'} />
                                  <span className="text-[15px] underline underline-offset-2 break-all">{m.text || t('Файл')}</span>
                                </a>
                              : <p className="leading-relaxed break-words text-[16.5px]">{renderTextWithLinks(m.text || '', mine)}</p>
                    }
                    <span className={`flex items-center justify-end gap-0.5 text-[10px] mt-0.5 ${mine ? 'text-white/60' : 'text-muted-foreground'}`}>
                      {fmtTime(m.created_at)}
                      {mine && (
                        m.is_read
                          ? <span className="text-green-400 leading-none ml-0.5">✓✓</span>
                          : <span className="leading-none ml-0.5 opacity-70">✓</span>
                      )}
                    </span>
                  </div>

                  {/* Реакции */}
                  {Object.keys(grouped).length > 0 && (
                    <div className={`flex gap-1 flex-wrap mt-1 ${mine ? 'justify-end' : 'justify-start'}`}>
                      {Object.entries(grouped).map(([e, c]) => (
                        <button key={e} onClick={ev => { ev.stopPropagation(); react(m.id, e); }}
                          className="glass rounded-full px-2 py-0.5 text-xs flex items-center gap-0.5 hover:bg-secondary/80">
                          {e} {c > 1 && <span className="text-muted-foreground">{c}</span>}
                        </button>
                      ))}
                    </div>
                  )}

                  {/* Emoji picker */}
                  {showEmoji && (
                    <div className={`absolute bottom-full mb-1 ${mine ? 'right-0' : 'left-0'} glass rounded-2xl p-2 flex gap-1 z-40 shadow-xl`}
                      onClick={e => e.stopPropagation()}>
                      {EMOJIS.map(e => (
                        <button key={e} onClick={() => react(m.id, e)} className="text-xl hover:scale-125 transition-transform">{e}</button>
                      ))}
                    </div>
                  )}
                </div>
              </div>

              {/* Контекстное меню */}
              {isSelected && !m.is_removed && (
                <div className={`flex gap-1 mt-1 animate-fade-up ${mine ? 'flex-row-reverse' : ''}`} onClick={e => e.stopPropagation()}>
                  <button onClick={() => { setEmojiTarget(m.id); setSelectedMsg(null); }}
                    className="glass rounded-full px-3 py-1.5 text-xs flex items-center gap-1 hover:bg-secondary/80">
                    😊 {t('Реакция')}
                  </button>
                  <button onClick={() => { openForward(m); setSelectedMsg(null); }}
                    className="glass rounded-full px-3 py-1.5 text-xs flex items-center gap-1 hover:bg-secondary/80">
                    <Icon name="Forward" size={12} /> {t('Переслать')}
                  </button>
                  {mine && (
                    <>
                      <button onClick={() => deleteMsg(m.id, false)}
                        className="glass rounded-full px-3 py-1.5 text-xs flex items-center gap-1 hover:bg-secondary/80 text-muted-foreground">
                        <Icon name="Trash2" size={12} /> {t('У меня')}
                      </button>
                      <button onClick={() => deleteMsg(m.id, true)}
                        className="glass rounded-full px-3 py-1.5 text-xs flex items-center gap-1 hover:bg-destructive/20 text-destructive">
                        <Icon name="Trash2" size={12} /> {t('У всех')}
                      </button>
                    </>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </main>

      {/* Composer — фиксированный снизу */}
      <div className="shrink-0 px-2 pt-2 pb-3 bg-white border-t border-slate-100"
        style={{ paddingBottom: 'calc(env(safe-area-inset-bottom) * 0.25 + 6px)' }}
        onClick={e => e.stopPropagation()}>
        <input ref={fileRef} type="file" hidden onChange={e => { const f = e.target.files?.[0]; if (f) uploadFile(f, fileType.current); e.target.value = ''; }} />
        <input ref={fileRef2} type="file" hidden accept="*/*" onChange={e => {
          const f = e.target.files?.[0]; if (!f) return;
          const reader = new FileReader();
          reader.onload = async () => {
            const [, b64] = (reader.result as string).split(',');
            const ext = f.name.split('.').pop() || 'bin';
            const d = await api('upload_media', 'POST', { user_id: user.id, data: b64, ext, media_type: 'file' });
            if (d.url) await send(f.name, d.url, 'file');
          };
          reader.readAsDataURL(f);
          e.target.value = '';
        }} />

        {/* Индикатор загрузки файла */}
        {uploading && (
          <div className="px-4 py-3 bg-blue-50 border-t border-blue-100">
            <div className="flex items-center gap-3 mb-2">
              <div className="w-4 h-4 border-2 border-blue-500 border-t-transparent rounded-full animate-spin shrink-0" />
              <span className="text-sm text-blue-600 font-medium flex-1">
                {uploadProgress === 'Сборка...' ? t('Сборка видео...') : uploadProgress === '100%' ? t('Готово!') : uploadProgress === 'Загрузка фото...' ? t('Загрузка фото...') : uploadProgress === 'Загрузка...' ? t('Загрузка...') : `${t('Загрузка')} ${uploadProgress}`}
              </span>
              <button onClick={() => { setUploading(false); setUploadProgress(''); }} className="w-6 h-6 rounded-full bg-blue-200 flex items-center justify-center hover:bg-blue-300 transition-colors shrink-0">
                <Icon name="X" size={14} className="text-blue-700" />
              </button>
            </div>
            <div className="w-full h-1.5 bg-blue-200 rounded-full overflow-hidden">
              <div className="h-full bg-blue-500 rounded-full transition-all duration-300"
                style={{ width: uploadProgress.endsWith('%') ? uploadProgress : uploadProgress === 'Сборка...' ? '97%' : '100%' }} />
            </div>
          </div>
        )}

        {/* Attach menu */}
        {showAttach && !recording && (
          <div className="flex gap-2 mb-3 animate-fade-up">
            {[
              { icon: 'Image', label: t('Фото'), type: 'image' as const },
              { icon: 'Music', label: t('Аудио'), type: 'audio' as const },
            ].map(a => (
              <button key={a.type} onClick={() => pickFile(a.type)}
                className="flex-1 bg-blue-50 border border-blue-100 rounded-2xl py-3 flex flex-col items-center gap-1 hover:bg-blue-100 transition-colors">
                <Icon name={a.icon} size={20} className="text-blue-600" />
                <span className="text-[10px] text-slate-500 font-medium">{a.label}</span>
              </button>
            ))}
            <button onClick={() => { setShowAttach(false); fileRef2.current?.click(); }}
              className="flex-1 bg-blue-50 border border-blue-100 rounded-2xl py-3 flex flex-col items-center gap-1 hover:bg-blue-100 transition-colors">
              <Icon name="FileText" size={20} className="text-blue-600" />
              <span className="text-[10px] text-slate-500 font-medium">{t('Файл')}</span>
            </button>
          </div>
        )}

        {/* Composer emoji panel */}
        {showComposerEmoji && !recording && (
          <div className="flex flex-wrap gap-1 mb-3 p-2 bg-slate-50 border border-slate-100 rounded-2xl animate-fade-up"
            onClick={e => e.stopPropagation()}>
            {COMPOSER_EMOJIS.map(e => (
              <button key={e} onClick={() => setInput(v => v + e)}
                className="w-9 h-9 flex items-center justify-center text-xl rounded-lg hover:bg-slate-200 transition-colors">
                {e}
              </button>
            ))}
          </div>
        )}

        {/* Recording UI */}
        {recording ? (
          <div className="flex items-center gap-3">
            <button onClick={cancelVoice}
              className="w-10 h-10 shrink-0 rounded-full flex items-center justify-center hover:bg-secondary/60 transition-colors text-destructive">
              <Icon name="Trash2" size={20} />
            </button>
            <div className="flex-1 flex items-center gap-2 bg-secondary/60 border border-destructive/40 rounded-full px-4 py-2.5">
              <span className="w-2 h-2 rounded-full bg-destructive animate-pulse shrink-0" />
              <span className="text-sm font-medium text-destructive">{t('Запись…')}</span>
              <span className="text-sm text-muted-foreground ml-auto">
                {String(Math.floor(recordSecs / 60)).padStart(2, '0')}:{String(recordSecs % 60).padStart(2, '0')}
              </span>
            </div>
            <button onClick={stopVoice}
              className="w-10 h-10 shrink-0 rounded-full bg-gradient-to-br from-primary to-accent flex items-center justify-center shadow-lg shadow-primary/30">
              <Icon name="Send" size={18} className="text-white" />
            </button>
          </div>
        ) : (
          <div className="flex items-center gap-2">
            <button onClick={() => { setShowComposerEmoji(false); setShowAttach(v => !v); }}
              className={`w-10 h-10 shrink-0 rounded-full flex items-center justify-center transition-colors ${showAttach ? 'bg-blue-100 text-blue-600' : 'text-slate-500 hover:bg-slate-100'}`}>
              <Icon name="Paperclip" size={22} />
            </button>
            <div className="flex-1 flex items-center bg-white border border-slate-200 rounded-full px-4 gap-2 shadow-sm">
              <input value={input} onChange={e => handleInput(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && !e.shiftKey && send()}
                placeholder={t('Сообщение')}
                className="flex-1 bg-transparent outline-none py-2.5 text-sm text-slate-800 placeholder:text-slate-400" />
              <button onClick={e => { e.stopPropagation(); setShowAttach(false); setShowComposerEmoji(v => !v); }}
                className={`shrink-0 transition-colors ${showComposerEmoji ? 'text-blue-600' : 'text-slate-400'}`}>
                <Icon name="Smile" size={20} />
              </button>
            </div>
            {input.trim()
              ? <button key="send" onClick={() => send()} disabled={uploading}
                  className="w-10 h-10 shrink-0 rounded-full bg-blue-600 flex items-center justify-center shadow-md shadow-blue-300/40 send-pop disabled:opacity-50 disabled:cursor-not-allowed">
                  <Icon name="Send" size={18} className="text-white" />
                </button>
              : <button key="mic" onClick={startVoice} disabled={uploading}
                  className="w-10 h-10 shrink-0 rounded-full flex items-center justify-center text-slate-500 hover:bg-slate-100 transition-colors disabled:opacity-50 disabled:cursor-not-allowed">
                  <Icon name="Mic" size={22} />
                </button>
            }
          </div>
        )}
      </div>

      {/* WebRTC звонок */}
      {inCall && peer && (
        <WebRTCCall
          user={user}
          peer={peer}
          callId={inCall.callId}
          kind={inCall.kind}
          outgoing={inCall.outgoing}
          onEnd={() => setInCall(null)}
        />
      )}
      {/* Fullscreen media viewer */}
      {mediaView && <MediaViewer src={mediaView.src} type={mediaView.type} onClose={() => setMediaView(null)} />}

      {/* Панель "Кто прочитал" */}
      {readByMsg && (
        <div className="fixed inset-0 z-[60] bg-black/40 flex items-end" onClick={() => setReadByMsg(null)}>
          <div className="bg-white rounded-t-3xl w-full max-h-[60vh] flex flex-col" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between px-5 pt-4 pb-3 border-b border-slate-100">
              <h3 className="font-bold text-slate-800">{t('Прочитали')}</h3>
              <button onClick={() => setReadByMsg(null)}><Icon name="X" size={20} className="text-slate-400" /></button>
            </div>
            <div className="overflow-y-auto flex-1 py-2">
              {readByMsg.readers.length === 0
                ? <p className="text-center text-slate-400 text-sm py-8">{t('Никто ещё не прочитал')}</p>
                : readByMsg.readers.map(r => (
                    <div key={r.id} className="flex items-center gap-3 px-5 py-2.5">
                      <Avatar url={r.avatar_url} nick={r.nick} size={38} />
                      <span className="font-medium text-slate-800 text-sm">@{r.nick}</span>
                      <Icon name="CheckCheck" size={16} className="text-green-500 ml-auto" />
                    </div>
                  ))
              }
            </div>
          </div>
        </div>
      )}

      {/* Модал пересылки */}
      {showForward && (
        <div className="fixed inset-0 z-[60] bg-black/50 flex items-end" onClick={() => setShowForward(false)}>
          <div className="bg-white dark:bg-slate-900 rounded-t-3xl w-full max-h-[70vh] flex flex-col"
            onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between px-5 pt-5 pb-3 border-b border-slate-100 dark:border-slate-800">
              <h3 className="font-bold text-slate-800 dark:text-white">{t('Переслать в чат')}</h3>
              <button onClick={() => setShowForward(false)}>
                <Icon name="X" size={20} className="text-slate-400" />
              </button>
            </div>
            <div className="overflow-y-auto flex-1 py-2">
              {forwardChats.map(c => (
                <button key={c.chat_id} onClick={() => doForward(c.chat_id)}
                  className="w-full flex items-center gap-3 px-5 py-3 hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors">
                  <Avatar url={c.peer_avatar ?? c.group_avatar} nick={c.peer_nick || c.group_name || '?'} size={44} />
                  <span className="font-semibold text-slate-800 dark:text-white text-sm">
                    {c.kind === 'group' ? c.group_name : `@${c.peer_nick}`}
                  </span>
                </button>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════════════
// NEW GROUP SCREEN (с подписчиками сразу)
// ══════════════════════════════════════════════════════════════════════════════
function NewGroupScreen({ user, onBack, onCreated }: { user: User; onBack: () => void; onCreated: (chatId: number, name: string, groupId: number) => void }) {
  const { t } = useLang();
  const [name, setName] = useState('');
  const [followers, setFollowers] = useState<User[]>([]);
  const [q, setQ] = useState('');
  const [selected, setSelected] = useState<User[]>([]);
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    api(`following&user_id=${user.id}`).then(d => setFollowers(d.users || []));
  }, [user.id]);

  const filtered = q.trim()
    ? followers.filter(u => u.nick.includes(q.trim().toLowerCase()))
    : followers;

  const toggle = (u: User) => setSelected(s => s.find(x => x.id === u.id) ? s.filter(x => x.id !== u.id) : [...s, u]);

  const create = async () => {
    if (!name.trim() || creating) return;
    setCreating(true);
    const d = await api('create_group', 'POST', { user_id: user.id, name: name.trim(), member_ids: selected.map(u => u.id) });
    setCreating(false);
    const chatId = Number(d.chat_id);
    const groupId = Number(d.group_id);
    if (!chatId || !groupId) return;
    onCreated(chatId, name.trim(), groupId);
  };

  return (
    <div className="fixed inset-0 flex flex-col" style={{ background: 'hsl(var(--background))' }}>
      <header className="flex items-center gap-3 px-4 bg-blue-600 shrink-0"
        style={{ paddingTop: 'calc(env(safe-area-inset-top) + 6px)', paddingBottom: '12px', borderRadius: '0 0 18px 18px', boxShadow: '0 4px 20px rgba(37,99,235,0.35)', zIndex: 10 }}>
        <button onClick={onBack} className="w-9 h-9 rounded-full hover:bg-white/15 flex items-center justify-center transition-colors">
          <Icon name="ArrowLeft" size={20} className="text-white" />
        </button>
        <span className="font-bold text-white flex-1">{t('Новая группа')}</span>
        <button onClick={create} disabled={!name.trim() || creating || selected.length === 0}
          className="px-5 py-2 rounded-xl bg-white text-blue-600 text-sm font-bold disabled:opacity-40 transition-all active:scale-95">
          {creating ? '...' : t('Создать')}
        </button>
      </header>

      <div className="flex-1 overflow-y-auto scrollbar-thin p-4 space-y-4">
        {/* Название */}
        <div className="bg-white dark:bg-slate-900 rounded-2xl p-4 border border-slate-100 dark:border-slate-800">
          <label className="text-xs font-semibold text-slate-500 dark:text-slate-400 mb-2 block">{t('Название группы')}</label>
          <input value={name} onChange={e => setName(e.target.value)} placeholder={t('Моя группа')} autoFocus
            className="w-full bg-slate-50 dark:bg-slate-800 border-2 border-slate-200 dark:border-slate-700 rounded-xl px-4 py-3 outline-none focus:border-blue-500 transition-all text-slate-800 dark:text-slate-100 text-sm" />
        </div>

        {/* Выбранные участники */}
        {selected.length > 0 && (
          <div className="bg-white dark:bg-slate-900 rounded-2xl p-4 border border-slate-100 dark:border-slate-800">
            <p className="text-xs font-semibold text-slate-500 dark:text-slate-400 mb-3">{t('Участники')}: {selected.length}</p>
            <div className="flex gap-2 flex-wrap">
              {selected.map(u => (
                <div key={u.id} className="flex items-center gap-1.5 bg-blue-50 dark:bg-slate-800 border border-blue-100 dark:border-slate-700 rounded-full pl-1.5 pr-3 py-1">
                  <Avatar url={u.avatar_url} nick={u.nick} size={20} />
                  <span className="text-xs font-semibold text-blue-700 dark:text-blue-400">@{u.nick}</span>
                  <button onClick={() => toggle(u)} className="ml-0.5 text-blue-400 hover:text-red-400">
                    <Icon name="X" size={12} />
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Список подписок */}
        <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-100 dark:border-slate-800 overflow-hidden">
          <div className="px-4 pt-4 pb-2">
            <p className="text-xs font-semibold text-slate-500 dark:text-slate-400 mb-3">{t('Подписки')} ({followers.length})</p>
            {followers.length > 3 && (
              <div className="relative mb-3">
                <Icon name="Search" size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 dark:text-slate-500" />
                <input value={q} onChange={e => setQ(e.target.value)} placeholder={t('Поиск…')}
                  className="w-full bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl pl-9 pr-4 py-2.5 outline-none focus:border-blue-500 transition-all text-sm dark:text-slate-100" />
              </div>
            )}
          </div>
          {followers.length === 0 && (
            <div className="flex flex-col items-center py-8 gap-2">
              <Icon name="Users" size={32} className="text-slate-200 dark:text-slate-700" />
              <p className="text-sm text-slate-400 dark:text-slate-500">{t('Нет подписок. Найди людей через поиск.')}</p>
            </div>
          )}
          {filtered.map(u => (
            <button key={u.id} onClick={() => toggle(u)}
              className="w-full flex items-center gap-3 px-4 py-3 hover:bg-blue-50 dark:hover:bg-slate-800 transition-colors border-t border-slate-50 dark:border-slate-800">
              <Avatar url={u.avatar_url} nick={u.nick} size={40} online={u.is_online} />
              <span className="flex-1 text-left font-semibold text-slate-800 dark:text-slate-100 text-sm">@{u.nick}</span>
              <div className={`w-6 h-6 rounded-full border-2 flex items-center justify-center transition-all ${selected.find(x => x.id === u.id) ? 'bg-blue-600 border-blue-600' : 'border-slate-300 dark:border-slate-600'}`}>
                {selected.find(x => x.id === u.id) && <Icon name="Check" size={13} className="text-white" />}
              </div>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}


// ══════════════════════════════════════════════════════════════════════════════
// STATUS CREATE SCREEN
// ══════════════════════════════════════════════════════════════════════════════
const STATUS_BG_COLORS = [
  'from-blue-500 to-indigo-600',
  'from-pink-500 to-rose-500',
  'from-emerald-500 to-teal-600',
  'from-orange-400 to-red-500',
  'from-purple-500 to-fuchsia-600',
  'from-slate-700 to-slate-900',
];

type StatusDraft = { file: File; preview: string; type: 'photo' | 'video' };

function StatusCreateScreen({ user, onBack, onCreated }: { user: User; onBack: () => void; onCreated: () => void }) {
  const { t } = useLang();
  const [type, setType] = useState<'text' | 'media'>('text');
  const [text, setText] = useState('');
  const [bgColor, setBgColor] = useState(STATUS_BG_COLORS[0]);
  const [drafts, setDrafts] = useState<StatusDraft[]>([]);
  const [caption, setCaption] = useState('');
  const [posting, setPosting] = useState(false);
  const [progress, setProgress] = useState('');
  const [error, setError] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);
  const draftsRef = useRef<StatusDraft[]>([]);
  draftsRef.current = drafts;

  const pick = () => {
    setError('');
    fileRef.current?.click();
  };

  const onFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    e.target.value = '';
    if (!files.length) return;
    const canAdd = 10 - draftsRef.current.length;
    if (canAdd <= 0) { setError(t('Максимум 10 файлов в одном статусе')); return; }
    setError('');
    for (const f of files.slice(0, canAdd)) {
      const isVideo = f.type.startsWith('video');
      const isPhoto = f.type.startsWith('image');
      if (!isVideo && !isPhoto) continue;
      const maxMb = isVideo ? 50 : 15;
      if (f.size > maxMb * 1024 * 1024) {
        setError(`${t('Файл слишком большой. Максимум')} ${maxMb} ${t('МБ.')}`);
        continue;
      }
      setDrafts(p => [...p, { file: f, preview: URL.createObjectURL(f), type: isVideo ? 'video' : 'photo' }]);
    }
  };

  const removeDraft = (idx: number) => {
    setDrafts(p => {
      const item = p[idx];
      if (item) URL.revokeObjectURL(item.preview);
      return p.filter((_, i) => i !== idx);
    });
  };

  const canPost = type === 'text' ? text.trim().length > 0 : drafts.length > 0;

  const post = async () => {
    if (!canPost || posting) return;
    setPosting(true);
    setError('');
    try {
      if (type === 'text') {
        const d = await api('status_create', 'POST', { user_id: user.id, type: 'text', content: text.trim(), bg_color: bgColor });
        if (d.error) { setError(d.error as string); return; }
      } else {
        for (let i = 0; i < drafts.length; i++) {
          const dr = drafts[i];
          setProgress(`${i + 1}/${drafts.length}`);
          const ext = (dr.file.name.split('.').pop() || (dr.type === 'photo' ? 'jpg' : 'mp4')).toLowerCase();
          const b64 = await new Promise<string>((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => resolve((reader.result as string).split(',')[1]);
            reader.onerror = reject;
            reader.readAsDataURL(dr.file);
          });
          const up = await api('upload_status_media', 'POST', { user_id: user.id, data: b64, ext, media_type: dr.type });
          if (up.error || !up.url) { setError((up.error as string) || t('Ошибка загрузки')); return; }
          const d = await api('status_create', 'POST', { user_id: user.id, type: dr.type, content: up.url, caption: caption.trim() || undefined });
          if (d.error) { setError(d.error as string); return; }
        }
      }
      onCreated();
    } catch (e) {
      setError(`${t('Ошибка')}: ${e}`);
    } finally {
      setPosting(false);
      setProgress('');
    }
  };

  return (
    <div className="fixed inset-0 flex flex-col bg-white dark:bg-slate-950 z-40" style={{ paddingTop: 'env(safe-area-inset-top)' }}>
      <div className="shrink-0 flex items-center justify-between px-4 py-3 border-b border-slate-100 dark:border-slate-800">
        <button onClick={onBack} className="w-9 h-9 rounded-full hover:bg-slate-100 dark:hover:bg-slate-800 flex items-center justify-center transition-colors">
          <Icon name="X" size={20} className="text-slate-600 dark:text-slate-300" />
        </button>
        <h1 className="font-bold text-slate-800 dark:text-slate-100">{t('Новый статус')}</h1>
        <button onClick={post} disabled={!canPost || posting}
          className="px-4 py-1.5 rounded-full bg-blue-600 text-white text-sm font-semibold disabled:opacity-40 transition-opacity">
          {posting ? (progress || t('Публикация...')) : t('Поделиться')}
        </button>
      </div>

      <div className="flex-1 overflow-y-auto p-4">
        <div className="flex gap-2 mb-4">
          {([
            { key: 'text', icon: 'Type', label: t('Текст') },
            { key: 'media', icon: 'Image', label: t('Фото/Видео') },
          ] as const).map(opt => (
            <button key={opt.key} onClick={() => setType(opt.key)}
              className={`flex-1 py-3 rounded-2xl flex flex-col items-center gap-1 border transition-colors ${type === opt.key ? 'bg-blue-50 dark:bg-blue-950/40 border-blue-200 dark:border-blue-900' : 'bg-slate-50 dark:bg-slate-900 border-slate-100 dark:border-slate-800'}`}>
              <Icon name={opt.icon} size={20} className={type === opt.key ? 'text-blue-600' : 'text-slate-400'} />
              <span className={`text-xs font-medium ${type === opt.key ? 'text-blue-600' : 'text-slate-500 dark:text-slate-400'}`}>{opt.label}</span>
            </button>
          ))}
        </div>

        <input ref={fileRef} type="file" accept="image/*,video/*" multiple hidden onChange={onFile} />

        {type === 'text' && (
          <>
            <div className={`w-full aspect-[9/12] max-h-[420px] rounded-3xl bg-gradient-to-br ${bgColor} flex items-center justify-center p-6 mb-4`}>
              <textarea value={text} onChange={e => setText(e.target.value.slice(0, 100))} autoFocus
                placeholder={t('Введите текст статуса...')} rows={4}
                className="w-full bg-transparent outline-none resize-none text-center text-white text-2xl font-semibold placeholder:text-white/60" />
            </div>
            <div className="flex items-center justify-between mb-4">
              <div className="flex gap-2">
                {STATUS_BG_COLORS.map(c => (
                  <button key={c} onClick={() => setBgColor(c)}
                    className={`w-8 h-8 rounded-full bg-gradient-to-br ${c} ${bgColor === c ? 'ring-2 ring-offset-2 ring-blue-500 dark:ring-offset-slate-950' : ''}`} />
                ))}
              </div>
              <span className="text-xs text-slate-400">{text.length}/100</span>
            </div>
          </>
        )}

        {type === 'media' && (
          <>
            <p className="text-xs font-semibold text-slate-500 dark:text-slate-400 mb-2 uppercase tracking-wide">
              {t('Фото и видео (до 10 шт.)')} · {drafts.length}/10
            </p>
            <div className="flex gap-2 flex-wrap mb-4">
              {drafts.map((d, i) => (
                <div key={i} className="relative w-20 h-20 rounded-2xl overflow-hidden bg-black">
                  {d.type === 'photo'
                    ? <img src={d.preview} className="w-full h-full object-cover" />
                    : <video src={d.preview} className="w-full h-full object-cover" />}
                  {d.type === 'video' && (
                    <div className="absolute inset-0 flex items-center justify-center bg-black/20">
                      <Icon name="Play" size={16} className="text-white" />
                    </div>
                  )}
                  <button onClick={() => removeDraft(i)}
                    className="absolute top-1 right-1 w-5 h-5 rounded-full bg-black/60 flex items-center justify-center">
                    <Icon name="X" size={10} className="text-white" />
                  </button>
                </div>
              ))}
              {drafts.length < 10 && (
                <button onClick={pick}
                  className="w-20 h-20 rounded-2xl border-2 border-dashed border-slate-200 dark:border-slate-700 flex flex-col items-center justify-center gap-1 text-slate-400 dark:text-slate-500 hover:bg-slate-50 dark:hover:bg-slate-900 transition-colors">
                  <Icon name="Plus" size={20} />
                  <span className="text-[10px]">{t('Добавить')}</span>
                </button>
              )}
            </div>
            {drafts.length > 0 && (
              <input value={caption} onChange={e => setCaption(e.target.value)} placeholder={t('Добавить подпись...')}
                className="w-full bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-2xl px-4 py-3 outline-none focus:ring-2 focus:ring-blue-500 transition-all text-slate-800 dark:text-slate-100 text-sm mb-4" />
            )}
            {drafts.length > 1 && (
              <p className="text-xs text-slate-400 dark:text-slate-500 text-center mb-2">{t('Каждый файл появится отдельным статусом в твоей истории')}</p>
            )}
          </>
        )}

        {error && <p className="text-sm text-red-500 text-center">{error}</p>}
      </div>
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════════════
// STATUS VIEW SCREEN — полноэкранный просмотр статусов (как Stories)
// ══════════════════════════════════════════════════════════════════════════════
function StatusViewScreen({ me, userId, onBack, onOpenChat, onOpenProfile }: { me: User; userId: number; onBack: () => void; onOpenChat: (peerId: number) => void; onOpenProfile: (userId: number) => void }) {
  const { t } = useLang();
  const [statuses, setStatuses] = useState<StatusItem[]>([]);
  const [index, setIndex] = useState(0);
  const [progress, setProgress] = useState(0);
  const [paused, setPaused] = useState(false);
  const [showViews, setShowViews] = useState(false);
  const [views, setViews] = useState<{ id: number; nick: string; avatar_url?: string | null; viewed_at: string }[]>([]);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [author, setAuthor] = useState<{ nick: string; avatar_url?: string | null } | null>(null);
  const startRef = useRef(0);
  const rafRef = useRef<number>();

  const isMine = userId === me.id;
  const DURATION = 5000;

  useEffect(() => {
    api(`statuses_user&user_id=${userId}&me=${me.id}`).then(d => {
      const list = (d.statuses as StatusItem[]) || [];
      setStatuses(list);
      if (list.length === 0) onBack();
    });
    api(`profile&user_id=${userId}&me=${me.id}`).then(d => {
      const p = d.user as { nick: string; avatar_url?: string | null } | undefined;
      if (p) setAuthor({ nick: p.nick, avatar_url: p.avatar_url });
    });
  }, [userId, me.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const current = statuses[index];

  useEffect(() => {
    if (!current) return;
    api('status_view', 'POST', { status_id: current.id, viewer_id: me.id });
  }, [current, me.id]);

  const goNext = useCallback(() => {
    setIndex(i => {
      if (i + 1 >= statuses.length) { onBack(); return i; }
      return i + 1;
    });
    setProgress(0);
  }, [statuses.length, onBack]);

  const goPrev = useCallback(() => {
    setIndex(i => Math.max(0, i - 1));
    setProgress(0);
  }, []);

  useEffect(() => {
    if (!current || paused || showViews || current.type === 'video') return;
    startRef.current = Date.now() - progress * DURATION;
    const tick = () => {
      const elapsed = Date.now() - startRef.current;
      const pct = Math.min(1, elapsed / DURATION);
      setProgress(pct);
      if (pct >= 1) { goNext(); return; }
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
    return () => { if (rafRef.current) cancelAnimationFrame(rafRef.current); };
  }, [current, paused, showViews, goNext]); // eslint-disable-line react-hooks/exhaustive-deps

  const loadViews = async () => {
    if (!current) return;
    const d = await api(`status_views&status_id=${current.id}&user_id=${me.id}`);
    setViews((d.views as { id: number; nick: string; avatar_url?: string | null; viewed_at: string }[]) || []);
    setShowViews(true);
  };

  const deleteStatus = async () => {
    if (!current) return;
    await api('status_delete', 'POST', { status_id: current.id, user_id: me.id });
    setConfirmDelete(false);
    const rest = statuses.filter(s => s.id !== current.id);
    if (rest.length === 0) { onBack(); return; }
    setStatuses(rest);
    setIndex(i => Math.min(i, rest.length - 1));
    setProgress(0);
  };

  const touchStartX = useRef(0);
  const onTouchStart = (e: React.TouchEvent) => { touchStartX.current = e.touches[0].clientX; setPaused(true); };
  const onTouchEnd = (e: React.TouchEvent) => {
    setPaused(false);
    const dx = e.changedTouches[0].clientX - touchStartX.current;
    if (Math.abs(dx) > 50) { if (dx > 0) { goPrev(); } else { goNext(); } }
  };

  if (!current) return null;

  return (
    <div className="fixed inset-0 z-50 bg-black flex flex-col" style={{ paddingTop: 'env(safe-area-inset-top)' }}
      onTouchStart={onTouchStart} onTouchEnd={onTouchEnd}>
      {/* Прогресс-бары */}
      <div className="shrink-0 flex gap-1 px-2 pt-2">
        {statuses.map((s, i) => (
          <div key={s.id} className="flex-1 h-0.5 rounded-full bg-white/30 overflow-hidden">
            <div className="h-full bg-white transition-none" style={{ width: i < index ? '100%' : i === index ? `${progress * 100}%` : '0%' }} />
          </div>
        ))}
      </div>

      {/* Шапка */}
      <div className="relative z-20 shrink-0 flex items-center gap-3 px-4 py-3">
        <Avatar url={author?.avatar_url} nick={author?.nick || '?'} size={36} />
        <div className="flex-1">
          <div className="text-white font-semibold text-sm">@{author?.nick}</div>
          <div className="text-white/60 text-xs">{fmtTime(current.created_at)}</div>
        </div>
        {isMine && (
          <button onClick={() => setConfirmDelete(true)} className="w-9 h-9 rounded-full hover:bg-white/10 flex items-center justify-center">
            <Icon name="Trash2" size={18} className="text-white" />
          </button>
        )}
        <button onClick={onBack} className="w-9 h-9 rounded-full hover:bg-white/10 flex items-center justify-center">
          <Icon name="X" size={20} className="text-white" />
        </button>
      </div>

      {/* Тап-зоны навигации — только в зоне контента, не перекрывают шапку и нижнюю панель */}
      <div className="absolute inset-0 top-[64px] bottom-[88px] flex z-10">
        <div className="w-1/3 h-full" onClick={goPrev} />
        <div className="w-1/3 h-full" onClick={() => setPaused(p => !p)} />
        <div className="w-1/3 h-full" onClick={goNext} />
      </div>

      {/* Контент */}
      <div className="flex-1 flex items-center justify-center px-4 relative">
        {current.type === 'text' && (
          <div className={`w-full h-full rounded-2xl bg-gradient-to-br ${current.bg_color || STATUS_BG_COLORS[0]} flex items-center justify-center p-8`}>
            <p className="text-white text-2xl font-semibold text-center break-words">{current.content}</p>
          </div>
        )}
        {current.type === 'photo' && (
          <img src={current.content} className="max-w-full max-h-full object-contain rounded-2xl" />
        )}
        {current.type === 'video' && (
          <video src={current.content} autoPlay playsInline className="max-w-full max-h-full object-contain rounded-2xl"
            onEnded={goNext} onLoadedMetadata={() => setProgress(0)} />
        )}
        {current.caption && (
          <div className="absolute bottom-4 left-4 right-4 text-center">
            <p className="text-white text-sm bg-black/40 rounded-xl px-3 py-2 inline-block">{current.caption}</p>
          </div>
        )}
      </div>

      {/* Нижняя панель */}
      <div className="shrink-0 px-4 pb-6 pt-2 flex items-center gap-3 z-20" style={{ paddingBottom: 'calc(env(safe-area-inset-bottom) + 16px)' }}>
        {isMine ? (
          <button onClick={loadViews} className="flex-1 flex items-center justify-center gap-2 py-3 rounded-full bg-white/10 text-white text-sm font-medium">
            <Icon name="Eye" size={16} /> {t('Просмотрели')}
          </button>
        ) : (
          <button onClick={() => onOpenChat(userId)} className="flex-1 flex items-center justify-center gap-2 py-3 rounded-full bg-white/10 text-white text-sm font-medium">
            <Icon name="MessageCircle" size={16} /> {t('Ответить')}
          </button>
        )}
      </div>

      {/* Модалка: кто просмотрел */}
      {showViews && (
        <div className="fixed inset-0 z-50 bg-black/60 flex items-end" onClick={() => setShowViews(false)}>
          <div className="bg-white dark:bg-slate-900 rounded-t-3xl w-full max-h-[60vh] overflow-y-auto p-5" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-bold text-slate-800 dark:text-slate-100">{t('Просмотрели')} ({views.length})</h3>
              <button onClick={() => setShowViews(false)}><Icon name="X" size={20} className="text-slate-400" /></button>
            </div>
            {views.length === 0
              ? <p className="text-center text-slate-400 py-8">{t('Пока никто не просмотрел')}</p>
              : views.map(v => (
                <button key={v.id} onClick={() => { setShowViews(false); onOpenProfile(v.id); }}
                  className="w-full flex items-center gap-3 py-2.5 hover:bg-slate-50 dark:hover:bg-slate-800 rounded-xl transition-colors px-1">
                  <Avatar url={v.avatar_url} nick={v.nick} size={40} />
                  <span className="flex-1 font-semibold text-left text-slate-800 dark:text-slate-100">@{v.nick}</span>
                  <span className="text-xs text-slate-400">{fmtTime(v.viewed_at)}</span>
                  <Icon name="ChevronRight" size={16} className="text-slate-300 dark:text-slate-600" />
                </button>
              ))
            }
          </div>
        </div>
      )}

      {/* Подтверждение удаления */}
      {confirmDelete && (
        <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center px-6" onClick={() => setConfirmDelete(false)}>
          <div className="bg-white dark:bg-slate-900 rounded-3xl p-5 w-full max-w-xs" onClick={e => e.stopPropagation()}>
            <p className="text-sm text-slate-700 dark:text-slate-200 mb-4 text-center">{t('Удалить этот статус?')}</p>
            <div className="flex gap-2">
              <button onClick={deleteStatus} className="flex-1 py-2.5 rounded-2xl bg-red-500 text-white text-sm font-semibold">{t('Удалить')}</button>
              <button onClick={() => setConfirmDelete(false)} className="flex-1 py-2.5 rounded-2xl bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 text-sm font-medium">{t('Отмена')}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════════════
// GROUP INFO SCREEN
// ══════════════════════════════════════════════════════════════════════════════
function GroupInfoScreen({ user, groupId, chatId, onBack, onOpenChat, onOpenProfile }: {
  user: User; groupId: number; chatId: number;
  onBack: () => void; onOpenChat: (name: string, photoUrl?: string | null) => void; onOpenProfile: (id: number) => void;
}) {
  const { t } = useLang();
  const [group, setGroup] = useState<GroupInfo | null>(null);
  const [members, setMembers] = useState<GroupMember[]>([]);
  const [invitable, setInvitable] = useState<User[]>([]);
  const [editName, setEditName] = useState('');
  const [editAbout, setEditAbout] = useState('');
  const [saving, setSaving] = useState(false);
  const [copied, setCopied] = useState(false);
  const [showPhotoMenu, setShowPhotoMenu] = useState(false);
  const [showInvite, setShowInvite] = useState(false);
  const [inviteQ, setInviteQ] = useState('');
  const [transferTarget, setTransferTarget] = useState<number | null>(null);
  const [kickTarget, setKickTarget] = useState<number | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    const d = await api(`group_info&group_id=${groupId}&user_id=${user.id}`);
    if (d.group) {
      const g = d.group as GroupInfo & { is_public?: boolean };
      setGroup(g);
      setMembers((d.members as GroupMember[]) || []);
      setInvitable((d.invitable as User[]) || []);
      setEditName(g.name || '');
      setEditAbout(g.about || '');
    }
  }, [groupId, user.id]);

  useEffect(() => { load(); }, [load]);

  const isAdmin = group?.my_role === 'owner' || group?.my_role === 'admin';
  const isOwner = group?.my_role === 'owner' || group?.owner_id === user.id;

  const saveField = async (fields: Record<string, unknown>) => {
    setSaving(true);
    await api('group_update', 'POST', { group_id: groupId, user_id: user.id, ...fields });
    setSaving(false); load();
  };

  const uploadPhoto = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]; if (!file) return;
    setShowPhotoMenu(false);
    try {
      const b64 = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve((reader.result as string).split(',')[1]);
        reader.onerror = reject;
        reader.readAsDataURL(file);
      });
      const ext = file.type.includes('png') ? 'png' : 'jpg';
      const d = await api('upload_group_photo', 'POST', { group_id: groupId, user_id: user.id, data: b64, ext });
      console.log('[GROUP_PHOTO] response:', d);
      await load();
    } catch (err) {
      console.error('[GROUP_PHOTO] error:', err);
      alert(t('Не удалось загрузить фото. Попробуй ещё раз.'));
    }
    e.target.value = '';
  };

  const removePhoto = async () => {
    setShowPhotoMenu(false);
    await api('remove_group_photo', 'POST', { group_id: groupId, user_id: user.id });
    load();
  };

  const copyLink = () => {
    const link = `${window.location.origin}/?join=${group?.invite_token}`;
    navigator.clipboard?.writeText(link);
    setCopied(true); setTimeout(() => setCopied(false), 1800);
  };

  const addMember = async (targetId: number) => {
    await api('group_add_member', 'POST', { group_id: groupId, user_id: user.id, target_id: targetId });
    setShowInvite(false); load();
  };

  const kick = async (targetId: number) => {
    await api('group_kick', 'POST', { group_id: groupId, user_id: user.id, target_id: targetId });
    setKickTarget(null); load();
  };

  const setRole = async (targetId: number, role: string) => {
    await api('group_set_role', 'POST', { group_id: groupId, user_id: user.id, target_id: targetId, role });
    load();
  };

  const transfer = async () => {
    if (!transferTarget) return;
    await api('group_transfer', 'POST', { group_id: groupId, user_id: user.id, new_owner_id: transferTarget });
    setTransferTarget(null); load();
  };

  const leave = async () => {
    await api('group_leave', 'POST', { group_id: groupId, user_id: user.id });
    onBack();
  };

  const roleLabel: Record<string, string> = { owner: `👑 ${t('Владелец')}`, admin: `⭐ ${t('Админ')}`, member: t('Участник') };
  const filteredInvitable = inviteQ.trim()
    ? invitable.filter(u => u.nick.toLowerCase().includes(inviteQ.toLowerCase()))
    : invitable;

  if (!group) return (
    <div className="min-h-screen flex items-center justify-center" style={{ background: 'hsl(var(--background))' }}>
      <div className="w-8 h-8 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
    </div>
  );

  const isPublic = group.is_public !== false;

  return (
    <div className="fixed inset-0 flex flex-col" style={{ background: 'hsl(var(--background))' }} onClick={() => { setShowPhotoMenu(false); setShowInvite(false); }}>
      <header className="flex items-center gap-3 px-4 bg-blue-600 shrink-0" onClick={e => e.stopPropagation()}
        style={{ paddingTop: 'calc(env(safe-area-inset-top) + 6px)', paddingBottom: '12px', borderRadius: '0 0 18px 18px', boxShadow: '0 4px 20px rgba(37,99,235,0.35)', zIndex: 10 }}>
        <button onClick={onBack} className="w-9 h-9 rounded-xl hover:bg-blue-500 flex items-center justify-center transition-colors">
          <Icon name="ArrowLeft" size={20} className="text-white" />
        </button>
        <span className="font-bold text-white flex-1">{t('Группа')}</span>
        <button onClick={() => onOpenChat(group?.name || '', group?.photo_url)} className="px-4 py-2 rounded-xl bg-white text-blue-600 text-sm font-bold transition-all active:scale-95">
          <Icon name="MessageCircle" size={15} className="inline mr-1" />{t('Чат')}
        </button>
      </header>

      <div className="flex-1 overflow-y-auto scrollbar-thin pb-8">

        {/* ── Шапка: фото + название + описание ── */}
        <div className="flex flex-col items-center pt-6 pb-2 px-4">

          {/* Фото группы */}
          <div className="relative" onClick={e => e.stopPropagation()}>
            {/* label напрямую триггерит input — работает на iOS */}
            <label htmlFor="group-photo-input" className="cursor-pointer block">
              <div className="w-24 h-24 rounded-full overflow-hidden">
                {group.photo_url
                  ? <img src={group.photo_url} className="w-full h-full object-cover" />
                  : <div className="w-full h-full bg-blue-600 flex items-center justify-center">
                      <Icon name="Users" size={36} className="text-white" />
                    </div>}
              </div>
              {isAdmin && (
                <div className="absolute -bottom-1 -right-1 w-8 h-8 rounded-full bg-blue-600 flex items-center justify-center shadow-md">
                  <Icon name="Camera" size={14} className="text-white" />
                </div>
              )}
            </label>
            <input
              id="group-photo-input"
              ref={fileRef}
              type="file"
              accept="image/*"
              className="hidden"
              disabled={!isAdmin}
              onChange={uploadPhoto}
            />
            {/* Меню удаления (если фото уже есть) */}
            {isAdmin && group.photo_url && (
              <button
                onClick={e => { e.stopPropagation(); removePhoto(); }}
                className="absolute -top-1 -right-1 w-6 h-6 rounded-full bg-red-500 flex items-center justify-center shadow-md"
              >
                <Icon name="X" size={12} className="text-white" />
              </button>
            )}
          </div>

          {/* Название (редактируемое) */}
          {isAdmin ? (
            <input
              value={editName}
              onChange={e => setEditName(e.target.value)}
              onBlur={() => editName.trim() && editName !== group.name && saveField({ name: editName.trim() })}
              className="font-bold text-2xl mt-4 text-center text-slate-800 dark:text-slate-100 bg-transparent outline-none border-b-2 border-transparent focus:border-blue-400 transition-colors px-2 w-full max-w-xs"
            />
          ) : (
            <h2 className="font-display font-bold text-2xl mt-4 dark:text-slate-100">{group.name}</h2>
          )}

          {/* Описание (редактируемое) */}
          {isAdmin ? (
            <textarea
              value={editAbout}
              onChange={e => setEditAbout(e.target.value)}
              onBlur={() => editAbout !== (group.about || '') && saveField({ about: editAbout || null })}
              rows={2}
              placeholder={t('О группе — нажми чтобы добавить')}
              className="text-sm text-slate-500 dark:text-slate-400 mt-2 text-center bg-transparent outline-none border-b-2 border-transparent focus:border-blue-400 transition-colors resize-none w-full max-w-xs placeholder:text-slate-300 dark:placeholder:text-slate-600"
            />
          ) : (
            group.about && <p className="text-sm text-slate-500 dark:text-slate-400 mt-2 text-center">{group.about}</p>
          )}

          <p className="text-xs text-slate-400 dark:text-slate-500 mt-2">
            {isPublic ? `🌐 ${t('Публичная')}` : `🔒 ${t('Закрытая')}`} · {group.member_count} {t('участников')}
          </p>
          {saving && <p className="text-xs text-blue-500 mt-1">{t('Сохраняю...')}</p>}
        </div>

        {/* ── Настройки (только для админа) ── */}
        {isAdmin && (
          <div className="mx-4 mb-3 bg-white dark:bg-slate-900 rounded-2xl overflow-hidden border border-slate-100 dark:border-slate-800">
            <div className="flex items-center justify-between px-4 py-3.5 border-b border-slate-100 dark:border-slate-800">
              <div>
                <p className="text-sm font-semibold text-slate-800 dark:text-slate-100">{isPublic ? t('Публичная группа') : t('Закрытая группа')}</p>
                <p className="text-xs text-slate-400 dark:text-slate-500">{isPublic ? t('Любой может вступить по ссылке') : t('Только по приглашению')}</p>
              </div>
              <button onClick={() => saveField({ is_public: !isPublic })}
                className={`relative w-11 h-6 rounded-full transition-colors ${isPublic ? 'bg-blue-600' : 'bg-slate-200 dark:bg-slate-700'}`}>
                <span className={`absolute top-0.5 w-5 h-5 rounded-full bg-white shadow transition-transform ${isPublic ? 'translate-x-5' : 'translate-x-0.5'}`} />
              </button>
            </div>
            <div className="px-4 py-3.5">
              <p className="text-xs text-slate-400 dark:text-slate-500 mb-2">{t('Ссылка-приглашение')}</p>
              <button onClick={copyLink}
                className="w-full py-2.5 rounded-xl bg-blue-600 text-white text-sm font-bold transition-all active:scale-[0.98]">
                <Icon name={copied ? 'Check' : 'Link'} size={14} className="inline mr-1.5" />
                {copied ? t('Скопировано!') : t('Скопировать ссылку')}
              </button>
            </div>
          </div>
        )}

        {/* Ссылка для не-админа */}
        {!isAdmin && (
          <div className="mx-4 mb-3">
            <button onClick={copyLink}
              className="w-full py-2.5 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200 text-sm font-medium flex items-center justify-center gap-2">
              <Icon name={copied ? 'Check' : 'Link'} size={14} className="text-blue-500" />
              {copied ? t('Скопировано!') : t('Скопировать ссылку')}
            </button>
          </div>
        )}

        {/* ── Участники ── */}
        <div className="mx-4 mb-3">
          <div className="flex items-center justify-between mb-2 px-1">
            <p className="text-xs text-slate-400 dark:text-slate-500 font-semibold uppercase tracking-wider">{t('Участники')} · {group.member_count}</p>
            {isAdmin && invitable.length > 0 && (
              <button onClick={e => { e.stopPropagation(); setShowInvite(v => !v); }}
                className="flex items-center gap-1 text-xs text-blue-600 font-semibold">
                <Icon name="UserPlus" size={14} /> {t('Пригласить')}
              </button>
            )}
          </div>

          {showInvite && (
            <div className="bg-white dark:bg-slate-900 rounded-2xl p-3 mb-3 border border-slate-100 dark:border-slate-800" onClick={e => e.stopPropagation()}>
              <p className="text-xs text-slate-400 dark:text-slate-500 mb-2 font-medium">{t('Выбери из подписок:')}</p>
              {invitable.length > 4 && (
                <input value={inviteQ} onChange={e => setInviteQ(e.target.value)} placeholder={t('Поиск...')}
                  className="w-full bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl px-3 py-2 text-sm outline-none focus:border-blue-500 mb-2 dark:text-slate-100" />
              )}
              <div className="max-h-48 overflow-y-auto space-y-1">
                {filteredInvitable.map(u => (
                  <button key={u.id} onClick={() => addMember(u.id)}
                    className="w-full flex items-center gap-3 px-3 py-2 rounded-xl hover:bg-blue-50 dark:hover:bg-slate-800 transition-colors">
                    <Avatar url={u.avatar_url} nick={u.nick} size={32} online={u.is_online} />
                    <span className="flex-1 text-left text-sm font-medium text-slate-800 dark:text-slate-100">@{u.nick}</span>
                    <Icon name="Plus" size={16} className="text-blue-500 shrink-0" />
                  </button>
                ))}
                {filteredInvitable.length === 0 && (
                  <p className="text-xs text-slate-400 dark:text-slate-500 text-center py-3">{t('Все подписки уже в группе')}</p>
                )}
              </div>
            </div>
          )}

          <div className="bg-white dark:bg-slate-900 rounded-2xl overflow-hidden border border-slate-100 dark:border-slate-800">
            {members.map((m, i) => (
              <div key={m.id} className={`flex items-center gap-3 px-4 py-3 ${i < members.length - 1 ? 'border-b border-slate-50 dark:border-slate-800' : ''}`}>
                <button onClick={() => m.id !== user.id && onOpenProfile(m.id)} className="flex items-center gap-3 flex-1 min-w-0 text-left">
                  <Avatar url={m.avatar_url} nick={m.nick} size={40} online={m.is_online} />
                  <div className="flex-1 min-w-0">
                    <div className="font-semibold text-sm text-slate-800 dark:text-slate-100 truncate">@{m.nick}{m.id === user.id ? ` (${t('вы')})` : ''}</div>
                    <div className="text-xs text-slate-400 dark:text-slate-500">{roleLabel[m.role] || t('Участник')}</div>
                  </div>
                </button>
                {isAdmin && m.id !== user.id && (
                  <div className="flex gap-1 shrink-0">
                    {isOwner && m.role === 'member' && (
                      <button onClick={() => setRole(m.id, 'admin')} title={t('Назначить админом')}
                        className="w-8 h-8 rounded-full hover:bg-yellow-50 dark:hover:bg-slate-800 flex items-center justify-center transition-colors">
                        <Icon name="Star" size={14} className="text-yellow-500" />
                      </button>
                    )}
                    {isOwner && m.role === 'admin' && (
                      <button onClick={() => setRole(m.id, 'member')} title={t('Снять права')}
                        className="w-8 h-8 rounded-full hover:bg-slate-100 dark:hover:bg-slate-700 flex items-center justify-center transition-colors">
                        <Icon name="StarOff" size={14} className="text-slate-400 dark:text-slate-500" />
                      </button>
                    )}
                    {isOwner && (
                      <button onClick={() => setTransferTarget(m.id)} title={t('Передать владение')}
                        className="w-8 h-8 rounded-full hover:bg-blue-50 dark:hover:bg-slate-800 flex items-center justify-center transition-colors">
                        <Icon name="Crown" size={14} className="text-blue-500" />
                      </button>
                    )}
                    <button onClick={() => setKickTarget(m.id)} title={t('Удалить из группы')}
                      className="w-8 h-8 rounded-full hover:bg-red-50 dark:hover:bg-slate-800 flex items-center justify-center transition-colors">
                      <Icon name="UserX" size={14} className="text-red-400" />
                    </button>
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>

        {kickTarget && (
          <div className="mx-4 mb-3 bg-white dark:bg-slate-900 rounded-2xl p-4 border border-slate-100 dark:border-slate-800">
            <p className="text-sm text-slate-700 dark:text-slate-200 mb-3">{t('Удалить')} @{members.find(m => m.id === kickTarget)?.nick} {t('из группы?')}</p>
            <div className="flex gap-2">
              <button onClick={() => kick(kickTarget)}
                className="flex-1 py-2.5 rounded-2xl bg-red-500 text-white text-sm font-semibold">{t('Удалить')}</button>
              <button onClick={() => setKickTarget(null)}
                className="flex-1 py-2.5 rounded-2xl bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 text-sm font-medium">{t('Отмена')}</button>
            </div>
          </div>
        )}

        {transferTarget && (
          <div className="mx-4 mb-3 bg-white dark:bg-slate-900 rounded-2xl p-4 border border-slate-100 dark:border-slate-800">
            <p className="text-sm text-slate-700 dark:text-slate-200 mb-3">{t('Передать владение')} @{members.find(m => m.id === transferTarget)?.nick}? {t('Вы станете обычным участником.')}</p>
            <div className="flex gap-2">
              <button onClick={transfer}
                className="flex-1 py-2.5 rounded-2xl bg-blue-600 text-white text-sm font-semibold">{t('Передать')}</button>
              <button onClick={() => setTransferTarget(null)}
                className="flex-1 py-2.5 rounded-2xl bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 text-sm font-medium">{t('Отмена')}</button>
            </div>
          </div>
        )}

        {/* Покинуть группу */}
        <div className="mx-4">
          <button onClick={leave}
            className="w-full py-3.5 rounded-2xl text-red-500 hover:bg-red-50 dark:hover:bg-slate-800 transition-colors text-sm font-medium flex items-center justify-center gap-2">
            <Icon name="LogOut" size={16} />{t('Покинуть группу')}
          </button>
        </div>
      </div>
    </div>
  );
}