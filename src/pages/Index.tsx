import { useState, useRef, useEffect, useCallback } from 'react';
import Icon from '@/components/ui/icon';

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

// ── types ─────────────────────────────────────────────────────────────────────
type User = { id: number; nick: string; avatar_url?: string | null; profile_complete?: boolean; is_online?: boolean };
type Profile = User & { city?: string; birthdate?: string; about?: string; is_online?: boolean; last_seen?: string; followers: number; following: number; i_follow?: boolean; i_blocked?: boolean };
type ChatItem = { chat_id: number; kind: 'dm' | 'group'; peer_id?: number; peer_nick?: string; peer_avatar?: string | null; peer_online?: boolean; group_id?: number; group_name?: string; group_avatar?: string | null; last_text?: string | null; last_at?: string | null; unread_count?: number };
type Message = { id: number; sender_id: number; sender_nick: string; sender_avatar?: string | null; text?: string | null; image_url?: string | null; media_type?: string | null; media_url?: string | null; created_at: string; is_removed?: boolean; is_read?: boolean; reactions?: { emoji: string; user_id: number }[] };
type Tab = 'search' | 'chats' | 'notifications' | 'realty' | 'profile';
type RealtyListing = { id: number; deal_type: 'sale'|'rent'; city: string; district?: string; street?: string; rooms?: number; area?: number; price: number; description?: string; phone?: string; photos?: string[]; is_paid: boolean; created_at: string; seller_id: number; seller_nick: string; seller_avatar?: string|null };
type Notif = { id: number; type: string; from_user_id?: number; from_nick?: string; from_avatar?: string | null; chat_id?: number; group_id?: number; payload?: string; is_read: boolean; created_at: string };
type GroupInfo = { id: number; name: string; about?: string; photo_url?: string | null; invite_token: string; owner_id: number; my_role?: string; member_count: number; is_public?: boolean };
type GroupMember = User & { role: string };

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
  | { name: 'realty_chat'; chatId: number; listing: RealtyListing };

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
    const iv = setInterval(doPing, 8000);
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
    if (screen.name === 'realty_chat') return <RealtyChatScreen
      user={user} chatId={screen.chatId} listing={screen.listing} onBack={back} />;
    const tab = (screen as { name: 'tabs'; tab: Tab }).tab;
    return (
      <TabsShell tab={tab} onTab={(t) => push({ name: 'tabs', tab: t })} user={user}>
        {tab === 'search' && <SearchTab user={user} onOpenProfile={(id) => push({ name: 'user_profile', userId: id })} />}
        {tab === 'chats' && <ChatsTab user={user}
          onOpenChat={(c) => push({ name: 'chat', chatId: c.chat_id, peer: c.peer_id ? { id: c.peer_id, nick: c.peer_nick!, avatar_url: c.peer_avatar } : undefined, groupName: c.group_name, groupId: c.group_id, groupPhotoUrl: c.group_avatar })}
          onNewGroup={() => push({ name: 'new_group' })}
          onOpenGroup={(gid, chatId) => push({ name: 'group_info', groupId: gid, chatId })}
          onOpenRealtyChat={(chatId, listing) => push({ name: 'realty_chat', chatId, listing })} />}
        {tab === 'realty' && <RealtyTab user={user}
          onOpenChat={(chatId, listing) => push({ name: 'realty_chat', chatId, listing })} />}
        {tab === 'notifications' && <NotificationsTab user={user}
          onOpenChat={(chatId) => push({ name: 'chat', chatId })}
          onOpenProfile={(id) => push({ name: 'user_profile', userId: id })}
          onCall={async (peerId, peerNick, peerAvatar, kind) => {
            const d = await api('open_chat', 'POST', { user_id: user.id, peer_id: peerId });
            const callId = `call_${Date.now()}`;
            setGlobalCall({ kind, callId, outgoing: true, peer: { id: peerId, nick: peerNick, avatar_url: peerAvatar } });
            push({ name: 'chat', chatId: d.chat_id as number, peer: (d.peer as User) || { id: peerId, nick: peerNick, avatar_url: peerAvatar } });
          }} />}
        {tab === 'profile' && <ProfileTab user={user} onLogout={logout} onUpdate={(u) => { setUser(u); localStorage.setItem('orbit_user', JSON.stringify(u)); }} onFollowers={(uid, mode) => push({ name: 'followers', userId: uid, mode })} lightTheme={lightTheme} onDeleteAccount={deleteAccount} />}
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
    const t = setTimeout(async () => {
      const d = await api(`check_nick&nick=${encodeURIComponent(q)}&user_id=0`);
      if (d.available) { setNickStatus('ok'); setNickHint('Ник свободен!'); }
      else { setNickStatus('taken'); setNickHint(d.error || 'Ник уже занят'); }
    }, 500);
    return () => clearTimeout(t);
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
        <h1 className="text-white font-bold text-2xl tracking-tight mb-1">Вай Мессенджер</h1>
        <p className="text-blue-200 text-sm">Быстро. Просто. Надёжно.</p>
      </div>

      {/* Карточка */}
      <div className="rounded-t-[32px] px-6 pt-7 pb-10 bg-white dark:bg-slate-900">

        {/* START */}
        {tab === 'start' && (
          <>
            <h2 className="text-slate-800 dark:text-white font-bold text-xl mb-1">Добро пожаловать</h2>
            <p className="text-slate-400 text-sm mb-7">Войди или создай новый аккаунт</p>
            <button onClick={() => setTab('register')} className={btnPrimary}
              style={{ background: 'linear-gradient(135deg, #2563eb, #1d4ed8)' }}>
              Создать аккаунт
            </button>
            <button onClick={() => setTab('login')} className={btnSecondary}>
              Уже есть аккаунт? Войти
            </button>
          </>
        )}

        {/* REGISTER */}
        {tab === 'register' && (
          <>
            <button onClick={() => setTab('start')} className="flex items-center gap-1.5 text-slate-400 text-sm mb-5 -ml-1">
              <Icon name="ArrowLeft" size={16} /> Назад
            </button>
            <h2 className="text-slate-800 dark:text-white font-bold text-xl mb-1">Создать аккаунт</h2>
            <p className="text-slate-400 text-sm mb-5">Придумай ник и пароль</p>

            {/* Ник */}
            <label className="text-xs font-semibold text-slate-500 mb-1.5 block">Ник</label>
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
              {nickHint || 'Только латиница, цифры и _'}
            </p>

            {/* Пароль */}
            <label className="text-xs font-semibold text-slate-500 mb-1.5 block">Пароль</label>
            <div className="relative mb-5">
              <input value={password} type={showPw ? 'text' : 'password'} placeholder="Минимум 4 символа"
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
              {loading ? 'Создаю...' : 'Зарегистрироваться'}
            </button>
            <button onClick={() => setTab('login')} className={btnSecondary}>
              Уже есть аккаунт? Войти
            </button>
          </>
        )}

        {/* LOGIN */}
        {tab === 'login' && (
          <>
            <button onClick={() => setTab('start')} className="flex items-center gap-1.5 text-slate-400 text-sm mb-5 -ml-1">
              <Icon name="ArrowLeft" size={16} /> Назад
            </button>
            <h2 className="text-slate-800 dark:text-white font-bold text-xl mb-1">С возвращением!</h2>
            <p className="text-slate-400 text-sm mb-5">Введи ник и пароль</p>

            <label className="text-xs font-semibold text-slate-500 mb-1.5 block">Ник</label>
            <div className="relative mb-4">
              <span className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400 font-medium select-none">@</span>
              <input value={nick} autoFocus placeholder="my_nickname" maxLength={30}
                onChange={e => setNick(e.target.value.replace(/[^a-zA-Z0-9_]/g, '').toLowerCase())}
                className={inputCls('pl-9 border-slate-200')} />
            </div>

            <label className="text-xs font-semibold text-slate-500 mb-1.5 block">Пароль</label>
            <div className="relative mb-5">
              <input value={password} type={showPw ? 'text' : 'password'} placeholder="Твой пароль"
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
              {loading ? 'Вхожу...' : 'Войти'}
            </button>
            <button onClick={() => setTab('register')} className={btnSecondary}>
              Нет аккаунта? Зарегистрироваться
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
        <h1 className="text-white font-bold text-xl mb-1">Расскажи о себе</h1>
        <p className="text-blue-200 text-sm text-center">Заполни профиль чтобы продолжить</p>
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
          <span className="text-xs text-slate-400 mt-2">Фото (необязательно)</span>
        </div>

        <div className="space-y-4">
          {/* Ник */}
          <div>
            <label className={label}>Ник</label>
            <div className="w-full bg-blue-50 border-2 border-blue-100 rounded-2xl px-4 py-3.5 text-blue-700 text-sm font-medium">
              @{user.nick}
            </div>
          </div>

          <div>
            <label className={label}>Город <span className="text-red-400">*</span></label>
            <input value={city} onChange={e => setCity(e.target.value)} placeholder="Москва" className={field} />
          </div>

          <div>
            <label className={label}>Дата рождения <span className="text-red-400">*</span></label>
            <input type="date" value={birthdate} onChange={e => setBirthdate(e.target.value)} className={field} />
          </div>

          <div>
            <label className={label}>О себе</label>
            <textarea value={about} onChange={e => setAbout(e.target.value)} rows={3}
              placeholder="Расскажи немного о себе..."
              className={`${field} resize-none`} />
          </div>

          {!canSave && (
            <p className="text-xs text-slate-400 text-center flex items-center justify-center gap-1">
              <Icon name="Info" size={13} className="text-blue-400" />
              Заполни город и дату рождения
            </p>
          )}

          <button onClick={save} disabled={saving || !canSave}
            className="w-full py-4 rounded-2xl font-bold text-white text-base disabled:opacity-40 transition-all active:scale-[0.98]"
            style={{ background: 'linear-gradient(135deg, #2563eb, #1d4ed8)' }}>
            {saving ? 'Сохраняю...' : 'Продолжить'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════════════
// TABS SHELL
// ══════════════════════════════════════════════════════════════════════════════
function TabsShell({ tab, onTab, children, user }: { tab: Tab; onTab: (t: Tab) => void; children: React.ReactNode; user: User }) {
  const [unreadNotifs, setUnreadNotifs] = useState(0);
  const [unreadChats, setUnreadChats] = useState(0);

  useEffect(() => {
    const loadNotifs = () => api(`notifications&user_id=${user.id}`).then(d => {
      setUnreadNotifs(Number(d.unread) || 0);
    });
    loadNotifs();
    const iv = setInterval(loadNotifs, 10000);
    return () => clearInterval(iv);
  }, [user.id]);

  useEffect(() => {
    const loadChats = () => api(`chats&user_id=${user.id}`).then(d => {
      const chats = (d.chats as Array<{ unread_count?: number }>) || [];
      const total = chats.reduce((sum, c) => sum + (Number(c.unread_count) || 0), 0);
      setUnreadChats(total);
    });
    loadChats();
    const iv = setInterval(loadChats, 5000);
    return () => clearInterval(iv);
  }, [user.id]);

  const tabs: { key: Tab; icon: string; label: string; badge?: number; emoji?: string }[] = [
    { key: 'search', icon: 'Search', label: 'Поиск' },
    { key: 'chats', icon: 'MessageCircle', label: 'Чаты', badge: unreadChats },
    { key: 'realty', icon: 'Home', label: 'Жильё' },
    { key: 'notifications', icon: 'Bell', label: 'События', badge: unreadNotifs },
    { key: 'profile', icon: 'User', label: 'Профиль' },
  ];
  return (
    <div className="flex flex-col" style={{ background: '#f0f4fa', height: '100dvh', paddingTop: 'env(safe-area-inset-top)' }}>
      <div className="flex-1 overflow-hidden flex flex-col pb-[80px]">{children}</div>
      <div className="fixed bottom-0 left-0 right-0 flex justify-center pt-2 px-4"
        style={{ background: 'linear-gradient(to top, #f0f4fa 60%, transparent)', paddingBottom: 'calc(env(safe-area-inset-bottom) + 12px)' }}>
        <nav className="flex items-center gap-1 px-2 py-2 rounded-[28px] shadow-xl"
          style={{ background: 'rgba(255,255,255,0.98)', backdropFilter: 'blur(24px)', boxShadow: '0 8px 32px rgba(30,58,138,0.13), 0 2px 8px rgba(30,58,138,0.08)' }}>
          {tabs.map(t => (
            <button key={t.key} onClick={() => onTab(t.key)}
              className="relative flex flex-col items-center transition-all"
              style={{ minWidth: 64 }}>
              <div className={`relative flex flex-col items-center justify-center gap-0.5 px-4 py-2 rounded-[20px] transition-all duration-200
                ${tab === t.key ? 'bg-blue-600 shadow-md shadow-blue-200' : 'hover:bg-slate-100'}`}>
                <Icon name={t.icon} size={21}
                  className={tab === t.key ? 'text-white' : 'text-slate-400'} />
                <span className={`text-[10px] font-semibold leading-none transition-colors
                  ${tab === t.key ? 'text-white' : 'text-slate-400'}`}>
                  {t.label}
                </span>
                {(t.badge || 0) > 0 && (
                  <span className="absolute top-1 right-1.5 min-w-[16px] h-4 rounded-full bg-red-500 text-white text-[9px] font-bold flex items-center justify-center px-0.5 shadow-sm">
                    {t.badge! > 99 ? '99+' : t.badge}
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
function ChatsTab({ user, onOpenChat, onNewGroup, onOpenGroup, onOpenRealtyChat }: { user: User; onOpenChat: (c: ChatItem) => void; onNewGroup: () => void; onOpenGroup: (gid: number, chatId: number) => void; onOpenRealtyChat: (chatId: number, listing: RealtyListing) => void }) {
  const [chats, setChats] = useState<ChatItem[]>([]);
  const [showMenu, setShowMenu] = useState(false);
  const [swipedId, setSwipedId] = useState<number | null>(null);
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<'all' | 'unread' | 'groups'>('all');

  const load = useCallback(async () => {
    const d = await api(`chats&user_id=${user.id}`);
    setChats(d.chats || []);
  }, [user.id]);

  useEffect(() => { load(); const iv = setInterval(load, 3000); return () => clearInterval(iv); }, [load]);

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
      <div className="shrink-0 bg-white px-4 pt-4 pb-2 border-b border-slate-100" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-3">
          <h1 className="text-2xl font-bold text-slate-900" style={{ letterSpacing: '-0.5px' }}>Чаты</h1>
          <div className="relative">
            <button onClick={() => setShowMenu(v => !v)}
              className="w-9 h-9 rounded-xl bg-blue-600 flex items-center justify-center shadow-sm shadow-blue-200 transition-all active:scale-95">
              <Icon name="Plus" size={18} className="text-white" />
            </button>
            {showMenu && (
              <div className="absolute right-0 top-11 bg-white rounded-2xl p-1 z-50 w-52 shadow-xl border border-slate-100 animate-fade-up">
                <button onClick={() => { setShowMenu(false); onNewGroup(); }}
                  className="w-full flex items-center gap-3 px-4 py-3 rounded-xl hover:bg-slate-50 transition-colors text-sm text-slate-700 font-medium">
                  <Icon name="Users" size={16} className="text-blue-600" /> Создать группу
                </button>
              </div>
            )}
          </div>
        </div>
        {/* Поиск */}
        <div className="flex items-center gap-2 bg-slate-100 rounded-2xl px-3 py-2.5 mb-3">
          <Icon name="Search" size={16} className="text-slate-400 shrink-0" />
          <input value={search} onChange={e => setSearch(e.target.value)}
            placeholder="Поиск"
            className="flex-1 bg-transparent outline-none text-sm text-slate-700 placeholder:text-slate-400" />
          {search && <button onClick={() => setSearch('')}><Icon name="X" size={14} className="text-slate-400" /></button>}
        </div>
        {/* Фильтры */}
        <div className="flex gap-2 overflow-x-auto scrollbar-none pb-1">
          {([
            { key: 'all', label: 'Все' },
            { key: 'unread', label: `Непрочитанные${unreadCount > 0 ? ` ${unreadCount}` : ''}` },
            { key: 'groups', label: `Группы${groupCount > 0 ? ` ${groupCount}` : ''}` },
          ] as const).map(f => (
            <button key={f.key} onClick={() => setFilter(f.key)}
              className={`shrink-0 px-4 py-1.5 rounded-full text-sm font-medium transition-colors ${filter === f.key ? 'bg-green-100 text-green-700' : 'bg-slate-100 text-slate-500 hover:bg-slate-200'}`}>
              {f.label}
            </button>
          ))}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto scrollbar-thin px-3 pb-2 bg-white">
        {visibleChats.length === 0 && (
          <div className="flex flex-col items-center justify-center mt-24 gap-3">
            <div className="w-16 h-16 rounded-2xl bg-blue-50 flex items-center justify-center">
              <Icon name="MessageCircle" size={32} className="text-blue-300" />
            </div>
            <p className="font-semibold text-slate-500 text-sm">{search ? 'Ничего не найдено' : 'Нет сообщений'}</p>
            <p className="text-xs text-slate-400">{search ? 'Попробуй другой запрос' : 'Найди людей через поиск'}</p>
          </div>
        )}
        {/* Чаты по объявлениям */}
        <RealtyChatsInline user={user} onOpen={onOpenRealtyChat} />
        {visibleChats.map(c => (
          <div key={c.chat_id} className="relative overflow-hidden rounded-2xl">
            {swipedId === c.chat_id && (
              <div className="absolute right-0 top-0 bottom-0 flex items-center pr-2 animate-slide-in-right">
                <button onClick={e => { e.stopPropagation(); setDeleteConfirm(c.chat_id); setSwipedId(null); }}
                  className="h-12 px-4 rounded-xl bg-red-500 text-white text-sm font-semibold flex items-center gap-1.5">
                  <Icon name="Trash2" size={15} /> Удалить
                </button>
              </div>
            )}
            {deleteConfirm === c.chat_id && (
              <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-6"
                onClick={() => setDeleteConfirm(null)}>
                <div className="bg-white rounded-3xl p-6 w-full max-w-sm space-y-3 shadow-2xl"
                  onClick={e => e.stopPropagation()}>
                  <p className="font-bold text-center text-slate-800 text-lg">Удалить чат?</p>
                  <p className="text-sm text-slate-500 text-center">Чат исчезнет только у тебя. Собеседник его не потеряет.</p>
                  <button onClick={() => hideChat(c.chat_id, false)}
                    className="w-full py-3.5 rounded-2xl bg-red-500 text-white text-sm font-bold mt-2">
                    Удалить у меня
                  </button>
                  <button onClick={() => setDeleteConfirm(null)}
                    className="w-full py-3 rounded-2xl text-sm text-slate-500 font-medium">
                    Отмена
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
                <div className="font-semibold text-slate-800 truncate text-[15px]">{c.kind === 'group' ? c.group_name : `@${c.peer_nick}`}</div>
                <div className="text-sm text-slate-400 truncate mt-0.5">{c.last_text || 'Нет сообщений'}</div>
              </div>
              <div className="flex flex-col items-end gap-1.5 shrink-0 ml-1">
                <span className="text-[11px] text-slate-400">{fmtTime(c.last_at || null)}</span>
                <div className="flex items-center gap-1">
                  {(c.unread_count || 0) > 0 && (
                    <span className="min-w-[20px] h-5 rounded-full bg-blue-600 text-white text-[11px] font-bold flex items-center justify-center px-1.5">
                      {(c.unread_count || 0) > 99 ? '99+' : c.unread_count}
                    </span>
                  )}
                  {c.kind === 'group' && c.group_id && (
                    <button onClick={e => { e.stopPropagation(); onOpenGroup(c.group_id!, c.chat_id); }}
                      className="w-5 h-5 rounded-full hover:bg-slate-100 flex items-center justify-center transition-colors">
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
// SEARCH TAB
// ══════════════════════════════════════════════════════════════════════════════
function SearchTab({ user, onOpenProfile }: { user: User; onOpenProfile: (id: number) => void }) {
  const [q, setQ] = useState('');
  const [results, setResults] = useState<(User & { city?: string; is_online?: boolean })[]>([]);

  useEffect(() => {
    if (!q.trim()) { setResults([]); return; }
    const t = setTimeout(async () => {
      const d = await api(`search&q=${encodeURIComponent(q.trim())}&user_id=${user.id}`);
      setResults(d.users || []);
    }, 250);
    return () => clearTimeout(t);
  }, [q, user.id]);

  return (
    <div className="flex flex-col h-full">
      <div className="shrink-0 px-4 pt-4 pb-3 bg-white border-b border-slate-100">
        <h1 className="text-2xl font-bold text-slate-900 mb-3" style={{ letterSpacing: '-0.5px' }}>Поиск</h1>
        <div className="flex items-center gap-2 bg-slate-100 rounded-2xl px-3 py-2.5">
          <Icon name="Search" size={16} className="text-slate-400 shrink-0" />
          <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="Найти по нику…"
            className="flex-1 bg-transparent outline-none text-sm text-slate-700 placeholder:text-slate-400" />
          {q && <button onClick={() => setQ('')}><Icon name="X" size={14} className="text-slate-400" /></button>}
        </div>
      </div>
      <div className="flex-1 overflow-y-auto scrollbar-thin px-3 pb-2">
        {q.trim() && results.length === 0 && <p className="text-center text-slate-400 mt-12 text-sm">Никого не найдено</p>}
        {results.map(u => (
          <button key={u.id} onClick={() => onOpenProfile(u.id)} className="w-full flex items-center gap-3 px-2 py-3 rounded-2xl hover:bg-blue-50 transition-colors animate-fade-up">
            <Avatar url={u.avatar_url} nick={u.nick} size={48} online={u.is_online} />
            <div className="flex-1 text-left">
              <div className="font-semibold text-slate-800">@{u.nick}</div>
              {u.city && <div className="text-xs text-slate-400">{u.city}</div>}
            </div>
            <Icon name="ChevronRight" size={18} className="text-slate-300" />
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

function NotificationsTab({ user, onOpenChat, onOpenProfile, onCall }: {
  user: User;
  onOpenChat: (chatId: number) => void;
  onOpenProfile: (id: number) => void;
  onCall: (peerId: number, peerNick: string, peerAvatar: string | null | undefined, kind: 'audio' | 'video') => void;
}) {
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
    const t = setTimeout(() => { if (!cancelled) setLoading(false); }, 5000);
    return () => { cancelled = true; clearTimeout(t); };
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
      <div className="shrink-0 px-4 pt-4 pb-0 bg-white border-b border-slate-100">
        <div className="flex items-center justify-between mb-3">
          <h1 className="text-2xl font-bold text-slate-900" style={{ letterSpacing: '-0.5px' }}>Уведомления</h1>
          {tab === 'notifs' && notifs.length > 0 && (
            <button onClick={clearAll} className="text-sm text-slate-400 hover:text-red-400 transition-colors font-medium flex items-center gap-1">
              <Icon name="Trash2" size={15} /> Очистить
            </button>
          )}
          {tab === 'calls' && calls.length > 0 && (
            <button onClick={clearCalls} className="text-sm text-slate-400 hover:text-red-400 transition-colors font-medium flex items-center gap-1">
              <Icon name="Trash2" size={15} /> Очистить
            </button>
          )}
        </div>
        <div className="flex gap-1 mb-0">
          <button onClick={() => setTab('notifs')}
            className={`flex-1 py-2 text-sm font-semibold rounded-t-xl transition-colors ${tab === 'notifs' ? 'text-blue-600 border-b-2 border-blue-600' : 'text-slate-400'}`}>
            Уведомления
          </button>
          <button onClick={() => { setTab('calls'); if (!calls.length) loadCalls(); }}
            className={`flex-1 py-2 text-sm font-semibold rounded-t-xl transition-colors ${tab === 'calls' ? 'text-blue-600 border-b-2 border-blue-600' : 'text-slate-400'}`}>
            Звонки
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto scrollbar-thin px-3 pb-2 pt-2">
        {/* Вкладка уведомлений */}
        {tab === 'notifs' && <>
          {loading && <div className="flex justify-center mt-16"><div className="w-7 h-7 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" /></div>}
          {!loading && notifs.length === 0 && (
            <div className="flex flex-col items-center justify-center mt-24 gap-3">
              <div className="w-16 h-16 rounded-2xl bg-blue-50 flex items-center justify-center"><Icon name="Bell" size={30} className="text-blue-300" /></div>
              <p className="font-semibold text-slate-500 text-sm">Нет уведомлений</p>
            </div>
          )}
          {notifs.map(n => (
            <div key={n.id} className={`flex items-start gap-3 px-3 py-3.5 rounded-2xl mb-2 transition-colors ${!n.is_read ? 'bg-blue-50 border border-blue-100' : 'bg-white border border-slate-100'}`}>
              <div className="relative shrink-0">
                <div className="w-12 h-12 rounded-2xl overflow-hidden bg-slate-100 flex items-center justify-center">
                  {n.from_avatar ? <img src={n.from_avatar} className="w-full h-full object-cover" /> : <span className="text-xl font-bold text-slate-400">{(n.from_nick || '?')[0].toUpperCase()}</span>}
                </div>
                <div className={`absolute -bottom-1 -right-1 w-5 h-5 rounded-full flex items-center justify-center ${n.type === 'missed_call' ? 'bg-red-500' : n.type === 'follow' ? 'bg-green-500' : 'bg-blue-500'}`}>
                  <Icon name={NOTIF_ICONS[n.type] || 'Bell'} size={11} className="text-white" />
                </div>
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-start justify-between gap-1">
                  <div>
                    {n.from_nick && <div className="text-sm font-bold text-slate-800">@{n.from_nick}</div>}
                    <div className={`text-xs font-medium mt-0.5 ${n.type === 'missed_call' ? 'text-red-500' : n.type === 'follow' ? 'text-green-600' : 'text-blue-600'}`}>{NOTIF_LABELS[n.type] || n.type}</div>
                  </div>
                  <div className="flex items-center gap-1.5 shrink-0">
                    <span className="text-[11px] text-slate-400">{fmtTime(n.created_at)}</span>
                    {!n.is_read && <span className="w-2 h-2 rounded-full bg-blue-500 shrink-0" />}
                  </div>
                </div>
                <div className="flex gap-2 mt-2 flex-wrap">
                  {n.type === 'missed_call' && n.from_user_id && (<>
                    <button onClick={() => onCall(n.from_user_id!, n.from_nick || '?', n.from_avatar, 'audio')} className="text-xs bg-green-500 text-white rounded-xl px-3 py-1.5 font-semibold flex items-center gap-1"><Icon name="Phone" size={12} /> Перезвонить</button>
                    <button onClick={() => onCall(n.from_user_id!, n.from_nick || '?', n.from_avatar, 'video')} className="text-xs bg-blue-500 text-white rounded-xl px-3 py-1.5 font-semibold flex items-center gap-1"><Icon name="Video" size={12} /> Видео</button>
                    <button onClick={() => onOpenProfile(n.from_user_id!)} className="text-xs bg-slate-100 text-slate-600 rounded-xl px-3 py-1.5 font-medium flex items-center gap-1"><Icon name="User" size={12} /> Профиль</button>
                  </>)}
                  {n.type === 'follow' && n.from_user_id && <button onClick={() => onOpenProfile(n.from_user_id!)} className="text-xs bg-blue-600 text-white rounded-xl px-3 py-1.5 font-semibold flex items-center gap-1"><Icon name="UserPlus" size={12} /> Профиль</button>}
                  {(n.type === 'new_message' || n.type === 'group_invite') && n.chat_id && <button onClick={() => onOpenChat(n.chat_id!)} className="text-xs bg-blue-600 text-white rounded-xl px-3 py-1.5 font-semibold flex items-center gap-1"><Icon name="MessageCircle" size={12} /> Открыть чат</button>}
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
              <div className="w-16 h-16 rounded-2xl bg-slate-50 flex items-center justify-center"><Icon name="Phone" size={30} className="text-slate-300" /></div>
              <p className="font-semibold text-slate-500 text-sm">Нет звонков</p>
            </div>
          )}
          {calls.map(c => {
            const isOutgoing = c.caller_id === user.id;
            const peerNick = isOutgoing ? c.callee_nick : c.caller_nick;
            const peerAvatar = isOutgoing ? c.callee_avatar : c.caller_avatar;
            const peerId = isOutgoing ? c.callee_id : c.caller_id;
            const missed = !isOutgoing && c.status !== 'active' && c.status !== 'ended';
            return (
              <div key={c.call_id} className="flex items-center gap-3 px-3 py-3.5 bg-white rounded-2xl mb-2 border border-slate-100">
                <div className="w-12 h-12 rounded-2xl overflow-hidden bg-slate-100 flex items-center justify-center shrink-0">
                  {peerAvatar ? <img src={peerAvatar} className="w-full h-full object-cover" /> : <span className="text-xl font-bold text-slate-400">{(peerNick || '?')[0].toUpperCase()}</span>}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="font-bold text-slate-800 text-sm">@{peerNick}</div>
                  <div className={`text-xs flex items-center gap-1 mt-0.5 ${missed ? 'text-red-500' : isOutgoing ? 'text-blue-500' : 'text-green-600'}`}>
                    <Icon name={isOutgoing ? 'PhoneOutgoing' : missed ? 'PhoneMissed' : 'PhoneIncoming'} size={11} />
                    {isOutgoing ? 'Исходящий' : missed ? 'Пропущенный' : 'Входящий'} · {c.kind === 'video' ? 'видео' : 'аудио'}
                  </div>
                  <div className="text-[11px] text-slate-400 mt-0.5">{fmtTime(c.created_at)}</div>
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
    <div className="fixed inset-0 flex flex-col" style={{ background: '#f0f4fa' }}>
      <header className="flex items-center gap-3 px-4 bg-blue-600 shrink-0"
        style={{ paddingTop: 'calc(env(safe-area-inset-top) + 6px)', paddingBottom: '12px', borderRadius: '0 0 18px 18px', boxShadow: '0 4px 20px rgba(37,99,235,0.35)', zIndex: 10 }}>
        <button onClick={onBack} className="w-9 h-9 rounded-full hover:bg-white/15 flex items-center justify-center transition-colors">
          <Icon name="ArrowLeft" size={20} className="text-white" />
        </button>
        <span className="font-bold text-white flex-1">{profile ? `@${profile.nick}` : '...'}</span>
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
            <h2 className="font-bold text-2xl mt-4 text-slate-800">@{profile.nick}</h2>
            <p className="text-sm text-slate-400 mt-1">
              {profile.is_online ? <span className="text-green-500 font-medium">в сети</span> : fmtLastSeen(profile.last_seen || null)}
            </p>
            <div className="flex gap-8 mt-5">
              <button onClick={() => onFollowers(userId, 'followers')} className="flex flex-col items-center hover:text-blue-600 transition-colors">
                <span className="font-bold text-xl text-slate-800">{profile.followers}</span>
                <span className="text-xs text-slate-400">подписчиков</span>
              </button>
              <button onClick={() => onFollowers(userId, 'following')} className="flex flex-col items-center hover:text-blue-600 transition-colors">
                <span className="font-bold text-xl text-slate-800">{profile.following}</span>
                <span className="text-xs text-slate-400">подписок</span>
              </button>
            </div>
          </div>
          <div className="px-4 space-y-2 mb-4 bg-white rounded-2xl mx-4 p-4 border border-slate-100">
            {profile.city && <div className="flex items-center gap-2 text-sm text-slate-700"><Icon name="MapPin" size={16} className="text-blue-500" />{profile.city}</div>}
            {profile.birthdate && <div className="flex items-center gap-2 text-sm text-slate-700"><Icon name="Cake" size={16} className="text-blue-500" />{new Date(profile.birthdate).toLocaleDateString('ru-RU')}</div>}
            {profile.about && <p className="text-sm mt-2 leading-relaxed text-slate-500">{profile.about}</p>}
          </div>
          <div className="px-4 space-y-3 pb-8 mt-2">
            {!profile.i_blocked ? (
              <>
                <button onClick={() => onOpenChat(userId)}
                  className="w-full py-3.5 rounded-2xl font-bold text-white text-sm transition-all active:scale-[0.98]"
                  style={{ background: 'linear-gradient(135deg, #2563eb, #1d4ed8)' }}>
                  <Icon name="MessageCircle" size={17} className="inline mr-2" />Написать
                </button>
                <div className="flex gap-2">
                  <button onClick={() => onCall?.({ id: userId, nick: profile.nick, avatar_url: profile.avatar_url }, 'audio')}
                    className="flex-1 py-3 rounded-2xl font-semibold bg-white border border-slate-200 text-slate-700 hover:bg-slate-50 transition-colors text-sm">
                    <Icon name="Phone" size={17} className="inline mr-2 text-blue-500" />Аудио
                  </button>
                  <button onClick={() => onCall?.({ id: userId, nick: profile.nick, avatar_url: profile.avatar_url }, 'video')}
                    className="flex-1 py-3 rounded-2xl font-semibold bg-white border border-slate-200 text-slate-700 hover:bg-slate-50 transition-colors text-sm">
                    <Icon name="Video" size={17} className="inline mr-2 text-blue-500" />Видео
                  </button>
                </div>
                {profile.i_follow
                  ? <button onClick={unfollow} className="w-full py-3.5 rounded-2xl font-semibold bg-white border border-slate-200 text-slate-700 hover:bg-slate-50 transition-colors text-sm">
                      <Icon name="UserCheck" size={17} className="inline mr-2 text-green-500" />Отписаться
                    </button>
                  : <button onClick={follow} className="w-full py-3.5 rounded-2xl font-semibold bg-white border border-slate-200 text-slate-700 hover:bg-slate-50 transition-colors text-sm">
                      <Icon name="UserPlus" size={17} className="inline mr-2 text-blue-500" />Подписаться
                    </button>
                }
                <button onClick={block} className="w-full py-3 rounded-2xl text-red-500 text-sm hover:bg-red-50 transition-colors">
                  <Icon name="Ban" size={15} className="inline mr-2" />Заблокировать
                </button>
              </>
            ) : (
              <button onClick={unblock} className="w-full py-3.5 rounded-2xl font-semibold bg-white border border-slate-200 hover:bg-slate-50 transition-colors text-red-500">
                <Icon name="Ban" size={18} className="inline mr-2" />Разблокировать
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
  const [list, setList] = useState<User[]>([]);
  useEffect(() => {
    api(`${mode}&user_id=${userId}`).then(d => setList(d.users || []));
  }, [userId, mode]);
  return (
    <div className="fixed inset-0 flex flex-col" style={{ background: '#f0f4fa' }}>
      <header className="flex items-center gap-3 px-4 bg-blue-600 shrink-0"
        style={{ paddingTop: 'calc(env(safe-area-inset-top) + 6px)', paddingBottom: '12px', borderRadius: '0 0 18px 18px', boxShadow: '0 4px 20px rgba(37,99,235,0.35)', zIndex: 10 }}>
        <button onClick={onBack} className="w-9 h-9 rounded-full hover:bg-white/15 flex items-center justify-center transition-colors">
          <Icon name="ArrowLeft" size={20} className="text-white" />
        </button>
        <span className="font-bold text-white">{mode === 'followers' ? 'Подписчики' : 'Подписки'}</span>
      </header>
      <div className="flex-1 overflow-y-auto scrollbar-thin px-3 pt-3">
        {list.length === 0 && <p className="text-center text-slate-400 mt-12 text-sm">Пусто</p>}
        {list.map(u => (
          <button key={u.id} onClick={() => onOpenProfile(u.id)}
            className="w-full flex items-center gap-3 px-2 py-3 rounded-2xl hover:bg-blue-50 transition-colors">
            <Avatar url={u.avatar_url} nick={u.nick} size={44} online={u.is_online} />
            <span className="font-semibold flex-1 text-left text-slate-800">@{u.nick}</span>
            <Icon name="ChevronRight" size={18} className="text-slate-300" />
          </button>
        ))}
      </div>
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════════════
// MY PROFILE TAB
// ══════════════════════════════════════════════════════════════════════════════
function ProfileTab({ user, onLogout, onUpdate, onFollowers, lightTheme, onDeleteAccount }: {
  user: User; onLogout: () => void; onUpdate: (u: User) => void;
  onFollowers: (uid: number, mode: 'followers' | 'following') => void;
  lightTheme: boolean;
  onDeleteAccount: () => void;
}) {
  const [profile, setProfile] = useState<Profile | null>(null);
  const [editing, setEditing] = useState(false);
  const [city, setCity] = useState('');
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

  const loadBlocked = async () => {
    const d = await api(`blocked&user_id=${user.id}`);
    setBlocked((d.users as User[]) || []);
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
    if (q === profile?.nick) { setNickStatus('ok'); setNickHint('Это твой текущий ник'); return; }
    setNickStatus('checking');
    const t = setTimeout(async () => {
      const d = await api(`check_nick&nick=${encodeURIComponent(q)}&user_id=${user.id}`);
      if (d.available) { setNickStatus('ok'); setNickHint('Ник свободен!'); }
      else { setNickStatus('taken'); setNickHint(d.error || 'Ник занят'); }
    }, 500);
    return () => clearTimeout(t);
  }, [newNick, editingNick, profile?.nick, user.id]);

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
      <div className="shrink-0 px-4 pt-4 pb-3 bg-white border-b border-slate-100 flex items-center justify-between">
        <h1 className="text-2xl font-bold text-slate-900" style={{ letterSpacing: '-0.5px' }}>Профиль</h1>
      </div>
      {/* Скроллится только контент */}
      <div className="flex-1 overflow-y-auto scrollbar-thin">

      {!profile && !loadError && (
        <div className="flex flex-col items-center justify-center flex-1 gap-3 mt-20">
          <div className="w-8 h-8 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
          <p className="text-sm text-slate-400">Загружаю профиль...</p>
        </div>
      )}
      {!profile && loadError && (
        <div className="flex flex-col items-center justify-center flex-1 gap-3 mt-20 px-6">
          <Icon name="WifiOff" size={40} className="text-slate-300" />
          <p className="text-sm text-slate-400 text-center">Не удалось загрузить профиль</p>
          <button onClick={load} className="px-5 py-2.5 rounded-2xl bg-blue-600 text-white text-sm font-semibold">
            Повторить
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
              <div className="absolute top-24 bg-white rounded-2xl p-1 z-50 w-52 shadow-xl border border-slate-100">
                <button onClick={() => { setShowAvatarMenu(false); fileRef.current?.click(); }} className="w-full flex items-center gap-3 px-4 py-3 rounded-xl hover:bg-slate-50 transition-colors text-sm text-slate-700">
                  <Icon name="Camera" size={16} className="text-blue-600" /> Изменить фото
                </button>
                {profile.avatar_url && (
                  <button onClick={removeAvatar} className="w-full flex items-center gap-3 px-4 py-3 rounded-xl hover:bg-red-50 transition-colors text-sm text-red-500">
                    <Icon name="Trash2" size={16} /> Удалить фото
                  </button>
                )}
              </div>
            )}
            {!editingNick ? (
              <button onClick={() => { setNewNick(profile.nick); setEditingNick(true); setNickStatus('idle'); setNickHint(''); }} className="flex items-center gap-2 mt-4 group">
                <h2 className="font-bold text-2xl text-slate-800">@{profile.nick}</h2>
                <Icon name="Pencil" size={15} className="text-slate-300 group-hover:text-slate-500 transition-colors" />
              </button>
            ) : (
              <div className="mt-4 w-full px-4">
                <div className="relative mb-1">
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 text-sm">@</span>
                  <input autoFocus value={newNick}
                    onChange={(e) => setNewNick(e.target.value.replace(/[^a-zA-Z0-9_]/g, '').toLowerCase())}
                    onKeyDown={(e) => { if (e.key === 'Enter') saveNick(); if (e.key === 'Escape') setEditingNick(false); }}
                    maxLength={30}
                    className="w-full bg-slate-50 border border-slate-200 rounded-2xl pl-8 pr-10 py-2.5 outline-none focus:ring-2 focus:ring-blue-500 transition-all text-center font-bold text-lg text-slate-800" />
                  <span className="absolute right-3 top-1/2 -translate-y-1/2">
                    {nickStatus === 'checking' && <span className="w-4 h-4 border-2 border-blue-500 border-t-transparent rounded-full animate-spin block" />}
                    {nickStatus === 'ok' && <Icon name="Check" size={15} className="text-green-500" />}
                    {nickStatus === 'taken' && <Icon name="X" size={15} className="text-red-500" />}
                  </span>
                </div>
                <p className={`text-xs text-center mb-2 h-4 ${nickStatus === 'ok' ? 'text-green-500' : 'text-red-500'}`}>{nickHint}</p>
                <div className="flex gap-2">
                  <button onClick={saveNick} disabled={nickSaving || nickStatus !== 'ok'} className="flex-1 py-2 rounded-xl bg-blue-600 text-white text-sm font-semibold disabled:opacity-40">
                    {nickSaving ? '...' : 'Сохранить'}
                  </button>
                  <button onClick={() => setEditingNick(false)} className="flex-1 py-2 rounded-xl bg-slate-100 text-slate-600 text-sm font-medium">Отмена</button>
                </div>
              </div>
            )}
            <div className="flex gap-8 mt-4">
              <button onClick={() => onFollowers(user.id, 'followers')} className="flex flex-col items-center hover:text-blue-600 transition-colors">
                <span className="font-bold text-xl text-slate-800">{profile.followers}</span>
                <span className="text-xs text-slate-400">подписчиков</span>
              </button>
              <button onClick={() => onFollowers(user.id, 'following')} className="flex flex-col items-center hover:text-blue-600 transition-colors">
                <span className="font-bold text-xl text-slate-800">{profile.following}</span>
                <span className="text-xs text-slate-400">подписок</span>
              </button>
            </div>
          </div>

          {/* Инфо / редактирование */}
          {!editing ? (
            <div className="bg-white rounded-3xl p-5 space-y-3 border border-slate-100">
              {profile.city && <div className="flex items-center gap-2 text-sm text-slate-700"><Icon name="MapPin" size={15} className="text-blue-500" />{profile.city}</div>}
              {profile.birthdate && <div className="flex items-center gap-2 text-sm text-slate-700"><Icon name="Cake" size={15} className="text-blue-500" />{new Date(profile.birthdate).toLocaleDateString('ru-RU')}</div>}
              {profile.about && <p className="text-sm text-slate-500 leading-relaxed">{profile.about}</p>}
              {!profile.city && !profile.birthdate && !profile.about && <p className="text-sm text-slate-400">Профиль не заполнен</p>}
              <button onClick={() => setEditing(true)} className="w-full py-3 rounded-2xl font-medium bg-slate-50 border border-slate-200 hover:bg-slate-100 transition-colors mt-2 text-slate-700 text-sm">
                <Icon name="Pencil" size={15} className="inline mr-2 text-blue-500" />Редактировать
              </button>
            </div>
          ) : (
            <div className="bg-white rounded-3xl p-5 space-y-4 border border-slate-100">
              <div>
                <label className="text-xs text-slate-400 mb-1 block font-medium">Город</label>
                <input value={city} onChange={(e) => setCity(e.target.value)} placeholder="Москва" className="w-full bg-slate-50 border border-slate-200 rounded-2xl px-4 py-3 outline-none focus:ring-2 focus:ring-blue-500 transition-all text-slate-800 text-sm" />
              </div>
              <div>
                <label className="text-xs text-slate-400 mb-1 block font-medium">Дата рождения</label>
                <input type="date" value={birthdate} onChange={(e) => setBirthdate(e.target.value)} className="w-full bg-slate-50 border border-slate-200 rounded-2xl px-4 py-3 outline-none focus:ring-2 focus:ring-blue-500 transition-all text-slate-800 text-sm" />
              </div>
              <div>
                <label className="text-xs text-slate-400 mb-1 block font-medium">О себе</label>
                <textarea value={about} onChange={(e) => setAbout(e.target.value)} rows={3} className="w-full bg-slate-50 border border-slate-200 rounded-2xl px-4 py-3 outline-none focus:ring-2 focus:ring-blue-500 transition-all resize-none text-slate-800 text-sm" />
              </div>
              <div className="flex gap-2">
                <button onClick={save} disabled={saving} className="flex-1 py-3 rounded-2xl font-semibold bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50 transition-all text-sm">
                  {saving ? 'Сохраняю...' : 'Сохранить'}
                </button>
                <button onClick={() => setEditing(false)} className="flex-1 py-3 rounded-2xl bg-slate-100 text-slate-600 text-sm font-medium hover:bg-slate-200 transition-colors">Отмена</button>
              </div>
            </div>
          )}

          {/* Настройки */}
          <div className="bg-white rounded-3xl p-5 border border-slate-100">
            <p className="text-xs text-slate-400 font-semibold uppercase tracking-wider mb-3 px-1">Настройки</p>
            <div className="flex items-center gap-3 py-2 px-1">
              <Icon name={lightTheme ? 'Sun' : 'Moon'} size={18} className="text-blue-500" />
              <div>
                <span className="text-sm font-medium text-slate-700">{lightTheme ? 'Светлая тема' : 'Тёмная тема'}</span>
                <p className="text-xs text-slate-400">Следует за системной темой телефона</p>
              </div>
            </div>
          </div>

          {/* О приложении / Документы */}
          <div className="bg-white rounded-3xl p-5 space-y-1 border border-slate-100">
            <p className="text-xs text-slate-400 font-semibold uppercase tracking-wider mb-3 px-1">О приложении</p>
            {[
              { label: 'Политика конфиденциальности', icon: 'Shield', doc: 'privacy' },
              { label: 'Пользовательское соглашение', icon: 'FileText', doc: 'terms' },
              { label: 'Шифрование и безопасность', icon: 'Lock', doc: 'security' },
            ].map(item => (
              <button key={item.doc} onClick={() => setShowDoc(item.doc as 'privacy'|'terms'|'security')}
                className="w-full flex items-center gap-3 py-3 px-1 hover:bg-slate-50 transition-colors rounded-xl">
                <Icon name={item.icon as 'Shield'} size={18} className="text-blue-500" />
                <span className="text-sm text-slate-700 flex-1 text-left">{item.label}</span>
                <Icon name="ChevronRight" size={16} className="text-slate-300" />
              </button>
            ))}
            <div className="pt-2 px-1">
              <p className="text-xs text-slate-400">Вай Мессенджер v1.0 · Соответствует ФЗ-152</p>
            </div>
          </div>

          {/* Аккаунт */}
          <div className="bg-white rounded-3xl p-5 space-y-1 border border-slate-100">
            <p className="text-xs text-slate-400 font-semibold uppercase tracking-wider mb-3 px-1">Аккаунт</p>
            <button onClick={() => { setShowBlocked(true); loadBlocked(); }}
              className="w-full flex items-center gap-3 py-3 px-1 hover:text-blue-600 transition-colors border-t border-slate-100">
              <Icon name="Ban" size={18} className="text-red-400" />
              <span className="text-sm text-slate-700 flex-1 text-left">Заблокированные</span>
              <Icon name="ChevronRight" size={16} className="text-slate-300" />
            </button>
            <button onClick={onLogout} className="w-full flex items-center gap-3 py-3 px-1 rounded-2xl hover:bg-slate-50 transition-colors">
              <Icon name="LogOut" size={18} className="text-slate-400" />
              <span className="text-sm font-medium text-slate-700">Выйти</span>
            </button>
            {!confirmDelete ? (
              <button onClick={() => setConfirmDelete(true)} className="w-full flex items-center gap-3 py-3 px-1 rounded-2xl hover:bg-red-50 transition-colors">
                <Icon name="Trash2" size={18} className="text-red-500" />
                <span className="text-sm font-medium text-red-500">Удалить аккаунт</span>
              </button>
            ) : (
              <div className="pt-2">
                <p className="text-sm text-red-500 mb-3 px-1">Удалить аккаунт навсегда? Это нельзя отменить.</p>
                <div className="flex gap-2">
                  <button onClick={onDeleteAccount} className="flex-1 py-2.5 rounded-2xl bg-red-500 text-white text-sm font-semibold">Удалить</button>
                  <button onClick={() => setConfirmDelete(false)} className="flex-1 py-2.5 rounded-2xl bg-slate-100 text-slate-600 text-sm font-medium">Отмена</button>
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
          <div className="bg-white rounded-t-3xl w-full max-h-[70vh] overflow-y-auto p-5" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-bold text-slate-800">Заблокированные</h3>
              <button onClick={() => setShowBlocked(false)}><Icon name="X" size={20} className="text-slate-400" /></button>
            </div>
            {blocked.length === 0
              ? <p className="text-center text-slate-400 py-8">Никого нет</p>
              : blocked.map(u => (
                <div key={u.id} className="flex items-center gap-3 py-3 border-b border-slate-50">
                  <Avatar url={u.avatar_url} nick={u.nick} size={44} />
                  <span className="flex-1 font-semibold text-slate-800">@{u.nick}</span>
                  <button onClick={async () => {
                    await api('unblock', 'POST', { user_id: user.id, target_id: u.id });
                    setBlocked(bs => bs.filter(b => b.id !== u.id));
                  }} className="px-4 py-1.5 rounded-full border border-slate-200 text-sm text-slate-600 hover:bg-slate-50">
                    Разблокировать
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
          <div className="bg-white rounded-t-3xl w-full max-h-[85vh] flex flex-col" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between px-5 pt-5 pb-3 border-b border-slate-100 shrink-0">
              <h3 className="font-bold text-slate-800 text-lg">
                {showDoc === 'privacy' ? 'Политика конфиденциальности'
                  : showDoc === 'terms' ? 'Пользовательское соглашение'
                  : 'Шифрование и безопасность'}
              </h3>
              <button onClick={() => setShowDoc(null)}><Icon name="X" size={20} className="text-slate-400" /></button>
            </div>
            <div className="overflow-y-auto flex-1 px-5 py-4 space-y-4 text-sm text-slate-700 leading-relaxed">
              {showDoc === 'privacy' && <>
                <p className="font-bold text-slate-900">Политика конфиденциальности Вай Мессенджер</p>
                <p className="text-xs text-slate-400">Редакция от 01.07.2026. Соответствует требованиям ФЗ-152 «О персональных данных».</p>
                <p><span className="font-semibold">1. Оператор персональных данных.</span> Вай Мессенджер является оператором персональных данных в соответствии с Федеральным законом № 152-ФЗ «О персональных данных».</p>
                <p><span className="font-semibold">2. Какие данные мы собираем.</span> При регистрации: имя пользователя (никнейм), пароль в зашифрованном виде (SHA-256). Дополнительно по желанию: город, дата рождения, фотография профиля, информация «О себе».</p>
                <p><span className="font-semibold">3. Сообщения.</span> Текстовые сообщения, фото, видео, аудио и файлы хранятся на серверах для обеспечения доставки. Удалённые вами сообщения физически помечаются как удалённые и не отображаются ни одной из сторон.</p>
                <p><span className="font-semibold">4. Как мы используем данные.</span> Данные используются исключительно для обеспечения работы мессенджера: авторизации, отправки сообщений, звонков и уведомлений. Данные не передаются третьим лицам и не используются в рекламных целях.</p>
                <p><span className="font-semibold">5. Хранение данных.</span> Данные хранятся на серверах, расположенных на территории Российской Федерации, в соответствии с требованиями ст. 18 ФЗ-152.</p>
                <p><span className="font-semibold">6. Права пользователя.</span> Вы вправе: получить доступ к своим данным; исправить неточные данные; удалить аккаунт и все связанные данные (кнопка «Удалить аккаунт» в профиле); отозвать согласие на обработку персональных данных.</p>
                <p><span className="font-semibold">7. Удаление аккаунта.</span> При удалении аккаунта все персональные данные, сообщения и медиафайлы пользователя удаляются безвозвратно в течение 30 дней.</p>
                <p><span className="font-semibold">8. Уведомления.</span> Push-уведомления отправляются через сервис OneSignal. Вы можете отключить их в настройках устройства в любое время.</p>
                <p><span className="font-semibold">9. Возраст.</span> Сервис предназначен для лиц старше 14 лет. Регистрация лиц младше 14 лет допускается только с согласия родителей или законных представителей.</p>
                <p><span className="font-semibold">10. Контакты.</span> По вопросам обработки персональных данных: поддержка доступна через раздел помощи в приложении.</p>
              </>}
              {showDoc === 'terms' && <>
                <p className="font-bold text-slate-900">Пользовательское соглашение Вай Мессенджер</p>
                <p className="text-xs text-slate-400">Редакция от 01.07.2026.</p>
                <p><span className="font-semibold">1. Принятие условий.</span> Регистрируясь в Вай Мессенджер, вы соглашаетесь с настоящим соглашением и Политикой конфиденциальности.</p>
                <p><span className="font-semibold">2. Регистрация.</span> При регистрации вы обязуетесь предоставить достоверные данные. Один пользователь — один аккаунт. Запрещается создавать аккаунты от имени других лиц.</p>
                <p><span className="font-semibold">3. Правила использования.</span> Запрещается: распространять незаконный контент; осуществлять спам-рассылки; использовать сервис для мошенничества; нарушать права других пользователей; распространять вирусы и вредоносное ПО.</p>
                <p><span className="font-semibold">4. Контент пользователей.</span> Вы несёте ответственность за все сообщения и медиафайлы, отправленные через сервис. Контент, нарушающий законодательство РФ, может быть удалён.</p>
                <p><span className="font-semibold">5. Звонки.</span> Голосовые и видеозвонки осуществляются через технологию WebRTC напрямую между устройствами (peer-to-peer) там, где это возможно. Запись звонков без согласия собеседника запрещена и является нарушением ст. 138 УК РФ.</p>
                <p><span className="font-semibold">6. Блокировка.</span> Администрация вправе заблокировать аккаунт при нарушении настоящего соглашения или законодательства РФ.</p>
                <p><span className="font-semibold">7. Ответственность.</span> Сервис предоставляется «как есть». Мы не несём ответственности за содержание переписки между пользователями.</p>
                <p><span className="font-semibold">8. Применимое право.</span> Настоящее соглашение регулируется законодательством Российской Федерации.</p>
              </>}
              {showDoc === 'security' && <>
                <p className="font-bold text-slate-900">Шифрование и безопасность</p>
                <p><span className="font-semibold">Пароли.</span> Пароли хранятся в виде хэша SHA-256. Оригинальный пароль нигде не сохраняется и не может быть восстановлен.</p>
                <p><span className="font-semibold">Передача данных.</span> Все соединения между приложением и сервером защищены протоколом HTTPS/TLS 1.3. Данные передаются в зашифрованном виде.</p>
                <p><span className="font-semibold">Звонки (WebRTC).</span> Голосовые и видеозвонки используют технологию WebRTC со встроенным шифрованием DTLS-SRTP. Медиапоток шифруется на уровне протокола между устройствами участников звонка.</p>
                <p><span className="font-semibold">Медиафайлы.</span> Фотографии, видео, аудио и файлы хранятся в защищённом S3-совместимом хранилище с доступом по уникальным ссылкам.</p>
                <p><span className="font-semibold">Уведомления.</span> Push-уведомления содержат минимум данных (ник отправителя, тип события) и не включают содержимое сообщений.</p>
                <p><span className="font-semibold">Серверы.</span> Серверная инфраструктура расположена на территории РФ в соответствии с требованиями ФЗ-152 о локализации персональных данных.</p>
                <p><span className="font-semibold">Сессии.</span> Ваш сеанс хранится локально на устройстве. При выходе из аккаунта сессия завершается и статус «онлайн» сбрасывается.</p>
                <p className="text-xs text-slate-400 pt-2">Если вы обнаружили уязвимость — сообщите нам через поддержку в приложении.</p>
              </>}
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

  // Своё видео: зеркало только для фронталки
  const localMirror = facingMode === 'user' ? 'scaleX(-1)' : 'none';

  // Перетаскивание маленького видео
  const [pipPos, setPipPos] = useState({ x: -1, y: -1 }); // -1 = дефолт (правый нижний угол)
  const pipDrag = useRef<{ startX: number; startY: number; ox: number; oy: number; moved: boolean } | null>(null);

  const onPipTouchStart = (e: React.TouchEvent) => {
    e.stopPropagation();
    const t = e.touches[0];
    const ox = pipPos.x === -1 ? window.innerWidth - 136 : pipPos.x;
    const oy = pipPos.y === -1 ? window.innerHeight - 285 : pipPos.y;
    pipDrag.current = { startX: t.clientX, startY: t.clientY, ox, oy, moved: false };
  };
  const onPipTouchMove = (e: React.TouchEvent) => {
    if (!pipDrag.current) return;
    e.stopPropagation();
    const t = e.touches[0];
    const dx = t.clientX - pipDrag.current.startX;
    const dy = t.clientY - pipDrag.current.startY;
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
                <span style={{ fontSize: 9, color: 'rgba(255,255,255,0.7)' }}>я</span>
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
              {status === 'active' ? fmt(duration) : outgoing ? 'Звонок...' : 'Соединение...'}
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
              <p className="text-white/50 text-sm">{outgoing ? 'Вызов...' : 'Соединяемся...'}</p>
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
            {status === 'active' ? `● ${fmt(duration)}` : outgoing ? 'Вызов...' : 'Соединяемся...'}
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
          {/* ··· */}
          <button style={{ width: 50, height: 50, borderRadius: '50%', background: 'rgba(80,80,80,0.7)',
            border: 'none', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <Icon name="MoreHorizontal" size={22} className="text-white" />
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
    </div>
  );
}

// ── INCOMING CALL BANNER ──────────────────────────────────────────────────────
function IncomingCallBanner({ caller, kind, onAccept, onReject }: {
  caller: { nick: string; avatar_url?: string | null }; kind: string;
  onAccept: () => void; onReject: () => void;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div className="w-[calc(100%-2rem)] max-w-xs bg-card border border-border rounded-3xl p-6 shadow-2xl flex flex-col items-center gap-5">
        {/* Аватар с пульсацией */}
        <div className="relative">
          <span className="absolute -inset-3 rounded-full bg-green-400/20 animate-pulse-ring" />
          <Avatar url={caller.avatar_url} nick={caller.nick} size={80} />
        </div>
        <div className="text-center">
          <p className="font-bold text-lg">@{caller.nick}</p>
          <p className="text-muted-foreground text-sm mt-0.5">
            {kind === 'video' ? '📹 Входящий видеозвонок' : '📞 Входящий звонок'}
          </p>
        </div>
        <div className="flex gap-4 w-full">
          <button onClick={onReject}
            className="flex-1 py-3.5 rounded-2xl bg-destructive text-white font-semibold flex items-center justify-center gap-2">
            <Icon name="PhoneOff" size={18} className="text-white" /> Отклонить
          </button>
          <button onClick={onAccept}
            className="flex-1 py-3.5 rounded-2xl bg-green-500 text-white font-semibold flex items-center justify-center gap-2">
            <Icon name="Phone" size={18} className="text-white" /> Принять
          </button>
        </div>
      </div>
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════════════
// НЕДВИЖИМОСТЬ — ВКЛАДКА
// ══════════════════════════════════════════════════════════════════════════════
const CITIES = ['Магас','Назрань','Малгобек','Карабулак','Сунжа','Грозный','Нальчик','Владикавказ','Черкесск','Махачкала','Ставрополь','Москва','Санкт-Петербург','Краснодар','Ростов-на-Дону','Минеральные Воды','Пятигорск','Кисловодск','Моздок','Прохладный'];

function fmtPrice(p: number) {
  if (p >= 1_000_000) return (p / 1_000_000).toFixed(1).replace(/\.0$/,'') + ' млн ₽';
  if (p >= 1_000) return Math.round(p / 1_000) + ' тыс ₽';
  return p + ' ₽';
}

// ── Чаты по объявлениям в списке чатов ───────────────────────────────────────
function RealtyChatsInline({ user, onOpen }: { user: User; onOpen: (chatId: number, listing: RealtyListing) => void }) {
  const [chats, setChats] = useState<{ chat_id: number; listing_id: number; city: string; district?: string; deal_type: string; rooms?: number; price: number; photos?: string[]; peer_nick: string; peer_avatar?: string|null; last_text?: string; last_at?: string }[]>([]);

  useEffect(() => {
    api(`realty_my_chats&user_id=${user.id}`).then(d => setChats((d.chats as typeof chats) || []));
  }, [user.id]);

  if (chats.length === 0) return null;

  return (
    <>
      <div className="px-2 py-2 mt-2">
        <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Чаты по объявлениям</p>
      </div>
      {chats.map(c => (
        <button key={c.chat_id} onClick={() => onOpen(c.chat_id, { id: c.listing_id, deal_type: c.deal_type as 'sale'|'rent', city: c.city, district: c.district, rooms: c.rooms, price: c.price, photos: c.photos, is_paid: true, created_at: '', seller_id: 0, seller_nick: c.peer_nick, seller_avatar: c.peer_avatar } as RealtyListing)}
          className="w-full flex items-center gap-3 px-2 py-3 rounded-2xl hover:bg-blue-50 transition-colors mb-1">
          <div className="w-12 h-12 rounded-2xl overflow-hidden bg-slate-100 shrink-0 flex items-center justify-center">
            {c.photos && c.photos[0] ? <img src={c.photos[0]} className="w-full h-full object-cover" /> : <span className="text-2xl">🏠</span>}
          </div>
          <div className="flex-1 min-w-0 text-left">
            <p className="font-semibold text-slate-800 text-sm truncate">{c.city} · {fmtPrice(c.price)}</p>
            <p className="text-xs text-slate-400 truncate mt-0.5">{c.last_text || 'Нет сообщений'}</p>
          </div>
          {c.last_at && <span className="text-[11px] text-slate-400 shrink-0">{new Date(c.last_at).toLocaleTimeString('ru-RU',{hour:'2-digit',minute:'2-digit'})}</span>}
        </button>
      ))}
      <div className="border-t border-slate-100 mt-2 mb-2" />
    </>
  );
}

function RealtyTab({ user, onOpenChat }: { user: User; onOpenChat: (chatId: number, listing: RealtyListing) => void }) {
  const [listings, setListings] = useState<RealtyListing[]>([]);
  const [favorites, setFavorites] = useState<RealtyListing[]>([]);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState('');
  const [showFilters, setShowFilters] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [selectedListing, setSelectedListing] = useState<RealtyListing | null>(null);
  const [activeTab, setActiveTab] = useState<'feed'|'favorites'>('feed');
  const [filters, setFilters] = useState({ deal_type: '', city: '', district: '', rooms: '', price_min: '', price_max: '' });

  const load = async (f = filters, search = q) => {
    setLoading(true);
    const p = new URLSearchParams({ ...(f.deal_type ? { deal_type: f.deal_type } : {}), ...(f.city ? { city: f.city } : {}), ...(f.district ? { district: f.district } : {}), ...(f.rooms ? { rooms: f.rooms } : {}), ...(f.price_min ? { price_min: f.price_min } : {}), ...(f.price_max ? { price_max: f.price_max } : {}), ...(search ? { q: search } : {}) });
    const d = await api(`realty_list&${p.toString()}`);
    setListings((d.listings as RealtyListing[]) || []);
    setLoading(false);
  };

  const loadFavorites = async () => {
    const d = await api(`realty_favorites&user_id=${user.id}`);
    setFavorites((d.listings as RealtyListing[]) || []);
  };

  useEffect(() => { load(); loadFavorites(); }, []);

  const displayedListings = activeTab === 'favorites' ? favorites : listings;

  return (
    <div className="flex flex-col h-full bg-slate-50">
      {/* Header */}
      <div className="shrink-0 bg-white border-b border-slate-100 px-4 pt-4 pb-3">
        <div className="flex items-center justify-between mb-3">
          <h1 className="text-2xl font-bold text-slate-900" style={{ letterSpacing: '-0.5px' }}>🏡 Недвижимость</h1>
          <button onClick={() => setShowForm(true)}
            className="flex items-center gap-1.5 bg-blue-600 text-white text-sm font-semibold px-4 py-2 rounded-2xl active:bg-blue-700 transition-colors">
            <Icon name="Plus" size={16} /> Подать
          </button>
        </div>
        {/* Вкладки */}
        <div className="flex gap-1 mb-3">
          <button onClick={() => setActiveTab('feed')}
            className={`flex-1 py-2 rounded-2xl text-sm font-semibold transition-colors ${activeTab === 'feed' ? 'bg-blue-600 text-white' : 'bg-slate-100 text-slate-500'}`}>
            Лента
          </button>
          <button onClick={() => { setActiveTab('favorites'); loadFavorites(); }}
            className={`flex-1 py-2 rounded-2xl text-sm font-semibold transition-colors flex items-center justify-center gap-1.5 ${activeTab === 'favorites' ? 'bg-red-500 text-white' : 'bg-slate-100 text-slate-500'}`}>
            ❤️ {favorites.length > 0 && <span className={`text-xs font-bold px-1.5 py-0.5 rounded-full ${activeTab === 'favorites' ? 'bg-white/25 text-white' : 'bg-red-100 text-red-600'}`}>{favorites.length}</span>}
          </button>

        </div>
        {activeTab === 'feed' && <div className="flex gap-2">
          <div className="relative flex-1">
            <Icon name="Search" size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <input value={q} onChange={e => setQ(e.target.value)} onKeyDown={e => e.key === 'Enter' && load(filters, q)}
              placeholder="Поиск по городу, описанию..."
              className="w-full bg-slate-100 rounded-2xl pl-9 pr-3 py-2.5 text-sm outline-none focus:ring-2 focus:ring-blue-500" />
          </div>
          <button onClick={() => setShowFilters(true)}
            className="px-3 py-2.5 rounded-2xl bg-slate-100 flex items-center gap-1.5 text-sm font-medium text-slate-600">
            <Icon name="SlidersHorizontal" size={15} /> Фильтры
          </button>
        </div>}
      </div>

      {/* Лента / Избранное */}
      <div className="flex-1 overflow-y-auto px-3 py-3 space-y-3">
        {loading && activeTab === 'feed' && <div className="flex justify-center mt-16"><div className="w-7 h-7 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" /></div>}
        {!loading && displayedListings.length === 0 && (
          <div className="flex flex-col items-center mt-20 gap-3">
            <div className="w-16 h-16 rounded-2xl bg-blue-50 flex items-center justify-center text-3xl">{activeTab === 'favorites' ? '❤️' : '🏠'}</div>
            <p className="text-slate-500 text-sm font-medium">{activeTab === 'favorites' ? 'Нет избранных объявлений' : 'Объявлений пока нет'}</p>
            {activeTab === 'feed' && <button onClick={() => setShowForm(true)} className="text-blue-600 text-sm font-semibold">Подать первое →</button>}
          </div>
        )}
        {displayedListings.map(l => (
          <button key={l.id} onClick={() => setSelectedListing(l)}
            className="w-full bg-white rounded-3xl overflow-hidden border border-slate-100 shadow-sm active:scale-[0.99] transition-transform text-left">
            {l.photos && l.photos.length > 0
              ? <img src={l.photos[0]} alt="" className="w-full h-44 object-cover" />
              : <div className="w-full h-44 bg-gradient-to-br from-blue-50 to-slate-100 flex items-center justify-center text-4xl">🏠</div>
            }
            <div className="p-4">
              <div className="flex items-start justify-between gap-2">
                <p className="font-bold text-xl text-slate-900">{fmtPrice(l.price)}</p>
                <span className={`text-xs font-semibold px-2 py-1 rounded-full ${l.deal_type === 'sale' ? 'bg-blue-100 text-blue-700' : 'bg-green-100 text-green-700'}`}>
                  {l.deal_type === 'sale' ? 'Продажа' : 'Аренда'}
                </span>
              </div>
              <p className="text-sm text-slate-700 mt-1 font-medium">
                {[l.rooms ? `${l.rooms}-комн.` : null, l.area ? `${l.area} м²` : null].filter(Boolean).join(' · ')}
              </p>
              <p className="text-sm text-slate-400 mt-0.5 flex items-center gap-1">
                <Icon name="MapPin" size={12} className="shrink-0" />
                {[l.city, l.district, l.street].filter(Boolean).join(', ')}
              </p>
            </div>
          </button>
        ))}
      </div>

      {/* Фильтры */}
      {showFilters && <RealtyFilters filters={filters} onApply={f => { setFilters(f); setShowFilters(false); load(f, q); }} onClose={() => setShowFilters(false)} />}

      {/* Форма публикации */}
      {showForm && <RealtyForm user={user} onClose={() => setShowForm(false)} onPublished={() => { setShowForm(false); load(); }} />}

      {/* Карточка объявления */}
      {selectedListing && <RealtyCard listing={selectedListing} user={user}
        onClose={() => setSelectedListing(null)}
        onOpenChat={onOpenChat}
        onDeleted={() => { load(); loadFavorites(); setSelectedListing(null); }} />}
    </div>
  );
}

// ── Фильтры ───────────────────────────────────────────────────────────────────
function RealtyFilters({ filters, onApply, onClose }: { filters: Record<string,string>; onApply: (f: Record<string,string>) => void; onClose: () => void }) {
  const [f, setF] = useState({ ...filters });
  const set = (k: string, v: string) => setF(p => ({ ...p, [k]: v }));
  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-end" onClick={onClose}>
      <div className="bg-white rounded-t-3xl w-full max-h-[85vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 pt-5 pb-3 border-b border-slate-100">
          <h3 className="font-bold text-lg text-slate-900">Фильтры</h3>
          <button onClick={onClose}><Icon name="X" size={20} className="text-slate-400" /></button>
        </div>
        <div className="px-5 py-4 space-y-5">
          <div>
            <p className="text-xs font-semibold text-slate-500 mb-2 uppercase tracking-wide">Тип сделки</p>
            <div className="flex gap-2">
              {[['','Все'],['sale','Купить'],['rent','Снять']].map(([v,l]) => (
                <button key={v} onClick={() => set('deal_type', v)}
                  className={`flex-1 py-2.5 rounded-2xl text-sm font-semibold border transition-colors ${f.deal_type === v ? 'bg-blue-600 text-white border-blue-600' : 'bg-white text-slate-600 border-slate-200'}`}>{l}</button>
              ))}
            </div>
          </div>
          <div>
            <p className="text-xs font-semibold text-slate-500 mb-2 uppercase tracking-wide">Город</p>
            <select value={f.city} onChange={e => set('city', e.target.value)}
              className="w-full bg-slate-50 border border-slate-200 rounded-2xl px-4 py-3 text-sm outline-none">
              <option value="">Любой</option>
              {CITIES.map(c => <option key={c} value={c}>{c}</option>)}
            </select>
          </div>
          <div>
            <p className="text-xs font-semibold text-slate-500 mb-2 uppercase tracking-wide">Район</p>
            <input value={f.district} onChange={e => set('district', e.target.value)} placeholder="Введите район..."
              className="w-full bg-slate-50 border border-slate-200 rounded-2xl px-4 py-3 text-sm outline-none focus:border-blue-500" />
          </div>
          <div>
            <p className="text-xs font-semibold text-slate-500 mb-2 uppercase tracking-wide">Комнат</p>
            <div className="flex gap-2">
              {[['','Любое'],['1','1'],['2','2'],['3','3'],['4','4'],['5','5+']].map(([v,l]) => (
                <button key={v} onClick={() => set('rooms', v)}
                  className={`flex-1 py-2 rounded-xl text-sm font-semibold border transition-colors ${f.rooms === v ? 'bg-blue-600 text-white border-blue-600' : 'bg-white text-slate-600 border-slate-200'}`}>{l}</button>
              ))}
            </div>
          </div>
          <div>
            <p className="text-xs font-semibold text-slate-500 mb-2 uppercase tracking-wide">Цена (₽)</p>
            <div className="flex gap-2 items-center">
              <input value={f.price_min} onChange={e => set('price_min', e.target.value)} placeholder="от"
                type="number" className="flex-1 bg-slate-50 border border-slate-200 rounded-2xl px-4 py-3 text-sm outline-none focus:border-blue-500" />
              <span className="text-slate-400">—</span>
              <input value={f.price_max} onChange={e => set('price_max', e.target.value)} placeholder="до"
                type="number" className="flex-1 bg-slate-50 border border-slate-200 rounded-2xl px-4 py-3 text-sm outline-none focus:border-blue-500" />
            </div>
          </div>
        </div>
        <div className="flex gap-3 px-5 pb-8">
          <button onClick={() => { const e = {deal_type:'',city:'',district:'',rooms:'',price_min:'',price_max:''}; setF(e); onApply(e); }}
            className="flex-1 py-3.5 rounded-2xl border border-slate-200 text-sm font-semibold text-slate-600">Сбросить</button>
          <button onClick={() => onApply(f)}
            className="flex-1 py-3.5 rounded-2xl bg-blue-600 text-white text-sm font-bold">Применить</button>
        </div>
      </div>
    </div>
  );
}

// ── Общая функция загрузки фото объявления ───────────────────────────────────
// Сжимает фото через Canvas до maxSize px и качества quality
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

async function uploadRealtyPhoto(file: File, userId: number): Promise<string | null> {
  try {
    const compressed = await compressImage(file, 1200, 0.82);
    const b64 = compressed.split(',')[1];
    const d = await api('realty_upload_photo', 'POST', { user_id: userId, data: b64, ext: 'jpg' });
    return d.url ? (d.url as string) : null;
  } catch { return null; }
}

// ── Форма публикации ──────────────────────────────────────────────────────────
function RealtyForm({ user, onClose, onPublished }: { user: User; onClose: () => void; onPublished: () => void }) {
  const [step, setStep] = useState<'form'|'pay'>('form');
  const [saving, setSaving] = useState(false);
  const [listingId, setListingId] = useState<number|null>(null);
  const [photos, setPhotos] = useState<string[]>([]);
  const [form, setForm] = useState({ deal_type: 'sale', city: '', district: '', street: '', rooms: '', area: '', price: '', description: '', phone: '' });
  const fileRef = useRef<HTMLInputElement>(null);
  const set = (k: string, v: string) => setForm(p => ({ ...p, [k]: v }));

  const [uploadingPhoto, setUploadingPhoto] = useState(false);
  const photosRef = useRef<string[]>([]);
  photosRef.current = photos;

  const uploadPhoto = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    e.target.value = '';
    if (!files.length) return;
    const canAdd = 10 - photosRef.current.length;
    if (canAdd <= 0) return;
    setUploadingPhoto(true);
    for (const f of files.slice(0, canAdd)) {
      const url = await uploadRealtyPhoto(f, user.id);
      if (url) setPhotos(p => [...p, url]);
    }
    setUploadingPhoto(false);
  };

  const submit = async () => {
    if (!form.city || !form.price) return;
    setSaving(true);
    const d = await api('realty_create', 'POST', { user_id: user.id, listing: { ...form, rooms: form.rooms ? +form.rooms : null, area: form.area ? +form.area : null, price: +form.price, photos } });
    setListingId(d.id as number);
    setSaving(false);
    setStep('pay');
  };

  const pay = async () => {
    if (!listingId) return;
    setSaving(true);
    await api('realty_pay', 'POST', { listing_id: listingId, user_id: user.id });
    setSaving(false);
    onPublished();
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-end" onClick={onClose}>
      <div className="bg-white rounded-t-3xl w-full max-h-[92vh] flex flex-col" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 pt-5 pb-3 border-b border-slate-100 shrink-0">
          <h3 className="font-bold text-lg">{step === 'form' ? 'Новое объявление' : 'Оплата публикации'}</h3>
          <button onClick={onClose}><Icon name="X" size={20} className="text-slate-400" /></button>
        </div>

        {step === 'form' && (
          <div className="overflow-y-auto flex-1 px-5 py-4 space-y-4">
            {/* Фото */}
            <div>
              <p className="text-xs font-semibold text-slate-500 mb-2 uppercase tracking-wide">Фото (до 10 шт.)</p>
              <div className="flex gap-2 flex-wrap">
                {photos.map((p, i) => (
                  <div key={i} className="relative w-20 h-20 rounded-2xl overflow-hidden">
                    <img src={p} className="w-full h-full object-cover" />
                    <button onClick={() => setPhotos(ps => ps.filter((_,j) => j !== i))}
                      className="absolute top-1 right-1 w-5 h-5 rounded-full bg-black/60 flex items-center justify-center">
                      <Icon name="X" size={10} className="text-white" />
                    </button>
                  </div>
                ))}
                {photos.length < 10 && (
                  <button onClick={() => fileRef.current?.click()} disabled={uploadingPhoto}
                    className="w-20 h-20 rounded-2xl border-2 border-dashed border-slate-200 flex flex-col items-center justify-center gap-1 text-slate-400 disabled:opacity-60">
                    {uploadingPhoto
                      ? <div className="w-5 h-5 border-2 border-blue-400 border-t-transparent rounded-full animate-spin" />
                      : <Icon name="Camera" size={20} />
                    }
                    <span className="text-[10px]">{uploadingPhoto ? 'Загрузка...' : 'Добавить'}</span>
                  </button>
                )}
                <input ref={fileRef} type="file" accept="image/*" multiple hidden onChange={uploadPhoto} />
              </div>
            </div>
            {/* Тип */}
            <div>
              <p className="text-xs font-semibold text-slate-500 mb-2 uppercase tracking-wide">Тип сделки</p>
              <div className="flex gap-2">
                {[['sale','Продажа'],['rent','Аренда']].map(([v,l]) => (
                  <button key={v} onClick={() => set('deal_type', v)}
                    className={`flex-1 py-2.5 rounded-2xl text-sm font-semibold border ${form.deal_type === v ? 'bg-blue-600 text-white border-blue-600' : 'border-slate-200 text-slate-600'}`}>{l}</button>
                ))}
              </div>
            </div>
            {/* Город */}
            <div>
              <p className="text-xs font-semibold text-slate-500 mb-2 uppercase tracking-wide">Город *</p>
              <select value={form.city} onChange={e => set('city', e.target.value)}
                className="w-full bg-slate-50 border border-slate-200 rounded-2xl px-4 py-3 text-sm outline-none focus:border-blue-500">
                <option value="">Выберите город</option>
                {CITIES.map(c => <option key={c} value={c}>{c}</option>)}
              </select>
            </div>
            {[['district','Район',''],['street','Улица, дом','']].map(([k,l,ph]) => (
              <div key={k}>
                <p className="text-xs font-semibold text-slate-500 mb-2 uppercase tracking-wide">{l}</p>
                <input value={(form as Record<string,string>)[k]} onChange={e => set(k, e.target.value)} placeholder={ph}
                  className="w-full bg-slate-50 border border-slate-200 rounded-2xl px-4 py-3 text-sm outline-none focus:border-blue-500" />
              </div>
            ))}
            {/* Комнаты + площадь */}
            <div className="flex gap-3">
              <div className="flex-1">
                <p className="text-xs font-semibold text-slate-500 mb-2 uppercase tracking-wide">Комнат</p>
                <input value={form.rooms} onChange={e => set('rooms', e.target.value)} type="number" placeholder="1"
                  className="w-full bg-slate-50 border border-slate-200 rounded-2xl px-4 py-3 text-sm outline-none focus:border-blue-500" />
              </div>
              <div className="flex-1">
                <p className="text-xs font-semibold text-slate-500 mb-2 uppercase tracking-wide">Площадь (м²)</p>
                <input value={form.area} onChange={e => set('area', e.target.value)} type="number" placeholder="50"
                  className="w-full bg-slate-50 border border-slate-200 rounded-2xl px-4 py-3 text-sm outline-none focus:border-blue-500" />
              </div>
            </div>
            {/* Цена */}
            <div>
              <p className="text-xs font-semibold text-slate-500 mb-2 uppercase tracking-wide">Цена (₽) *</p>
              <input value={form.price} onChange={e => set('price', e.target.value)} type="number" placeholder="3500000"
                className="w-full bg-slate-50 border border-slate-200 rounded-2xl px-4 py-3 text-sm outline-none focus:border-blue-500" />
            </div>
            {/* Описание */}
            <div>
              <p className="text-xs font-semibold text-slate-500 mb-2 uppercase tracking-wide">Описание</p>
              <textarea value={form.description} onChange={e => set('description', e.target.value)} placeholder="Опишите объект..." maxLength={500} rows={3}
                className="w-full bg-slate-50 border border-slate-200 rounded-2xl px-4 py-3 text-sm outline-none focus:border-blue-500 resize-none" />
              <p className="text-right text-xs text-slate-400 mt-1">{form.description.length}/500</p>
            </div>
            {/* Телефон */}
            <div>
              <p className="text-xs font-semibold text-slate-500 mb-2 uppercase tracking-wide">Телефон продавца</p>
              <input value={form.phone} onChange={e => set('phone', e.target.value)} placeholder="+7 (___) ___-__-__" type="tel"
                className="w-full bg-slate-50 border border-slate-200 rounded-2xl px-4 py-3 text-sm outline-none focus:border-blue-500" />
            </div>
            <button onClick={submit} disabled={saving || !form.city || !form.price}
              className="w-full py-4 rounded-2xl bg-blue-600 text-white font-bold text-base disabled:opacity-40">
              {saving ? 'Сохранение...' : 'Далее — Оплата 50 ₽ →'}
            </button>
          </div>
        )}

        {step === 'pay' && (
          <div className="flex-1 flex flex-col items-center justify-center px-6 gap-6">
            <div className="w-20 h-20 rounded-3xl bg-green-50 flex items-center justify-center text-4xl">💳</div>
            <div className="text-center">
              <h3 className="font-bold text-xl text-slate-900 mb-2">Оплата публикации</h3>
              <p className="text-slate-500 text-sm">После оплаты объявление сразу появится в ленте и получит значок ✅</p>
            </div>
            <div className="w-full bg-slate-50 rounded-3xl p-5 text-center">
              <p className="text-4xl font-bold text-slate-900">50 ₽</p>
              <p className="text-sm text-slate-400 mt-1">Размещение на 30 дней</p>
            </div>
            <button onClick={pay} disabled={saving}
              className="w-full py-4 rounded-2xl bg-blue-600 text-white font-bold text-lg disabled:opacity-40">
              {saving ? '...' : 'Оплатить 50 ₽'}
            </button>
            <p className="text-xs text-slate-400 text-center">Демо-режим: реального списания нет. Оплата через ЮKassa / СБП будет подключена позже.</p>
          </div>
        )}
      </div>
    </div>
  );
}

// ── Форма редактирования объявления ──────────────────────────────────────────
function RealtyEditForm({ listing, user, onClose, onSaved }: { listing: RealtyListing; user: User; onClose: () => void; onSaved: () => void }) {
  const [saving, setSaving] = useState(false);
  const [photos, setPhotos] = useState<string[]>(listing.photos || []);
  const [form, setForm] = useState({
    deal_type: listing.deal_type,
    city: listing.city || '',
    district: listing.district || '',
    street: listing.street || '',
    rooms: listing.rooms ? String(listing.rooms) : '',
    area: listing.area ? String(listing.area) : '',
    price: String(listing.price),
    description: listing.description || '',
    phone: listing.phone || '',
  });
  const fileRef = useRef<HTMLInputElement>(null);
  const set = (k: string, v: string) => setForm(p => ({ ...p, [k]: v }));
  const [uploadingPhoto, setUploadingPhoto] = useState(false);
  const photosRef = useRef<string[]>([]);
  photosRef.current = photos;

  const uploadPhoto = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    e.target.value = '';
    if (!files.length) return;
    const canAdd = 10 - photosRef.current.length;
    if (canAdd <= 0) return;
    setUploadingPhoto(true);
    for (const f of files.slice(0, canAdd)) {
      const url = await uploadRealtyPhoto(f, user.id);
      if (url) setPhotos(p => [...p, url]);
    }
    setUploadingPhoto(false);
  };

  const save = async () => {
    if (!form.city || !form.price) return;
    setSaving(true);
    await api('realty_edit', 'POST', {
      user_id: user.id,
      listing_id: listing.id,
      listing: { ...form, rooms: form.rooms ? +form.rooms : null, area: form.area ? +form.area : null, price: +form.price, photos }
    });
    setSaving(false);
    onSaved();
  };

  return (
    <div className="fixed inset-0 z-[110] bg-black/50 flex items-end" onClick={onClose}>
      <div className="bg-white rounded-t-3xl w-full max-h-[92vh] flex flex-col" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 pt-5 pb-3 border-b border-slate-100 shrink-0">
          <h3 className="font-bold text-lg">Редактировать объявление</h3>
          <button onClick={onClose}><Icon name="X" size={20} className="text-slate-400" /></button>
        </div>
        <div className="overflow-y-auto flex-1 px-5 py-4 space-y-4">
          {/* Фото */}
          <div>
            <p className="text-xs font-semibold text-slate-500 mb-2 uppercase tracking-wide">Фото</p>
            <div className="flex gap-2 flex-wrap">
              {photos.map((p, i) => (
                <div key={i} className="relative w-20 h-20 rounded-2xl overflow-hidden">
                  <img src={p} className="w-full h-full object-cover" />
                  <button onClick={() => setPhotos(ps => ps.filter((_,j) => j !== i))}
                    className="absolute top-1 right-1 w-5 h-5 rounded-full bg-black/60 flex items-center justify-center">
                    <Icon name="X" size={10} className="text-white" />
                  </button>
                </div>
              ))}
              {photos.length < 10 && (
                <button onClick={() => fileRef.current?.click()} disabled={uploadingPhoto}
                  className="w-20 h-20 rounded-2xl border-2 border-dashed border-slate-200 flex flex-col items-center justify-center gap-1 text-slate-400 disabled:opacity-60">
                  {uploadingPhoto
                    ? <div className="w-5 h-5 border-2 border-blue-400 border-t-transparent rounded-full animate-spin" />
                    : <Icon name="Camera" size={20} />
                  }
                  <span className="text-[10px]">{uploadingPhoto ? 'Загрузка...' : 'Добавить'}</span>
                </button>
              )}
              <input ref={fileRef} type="file" accept="image/*" multiple hidden onChange={uploadPhoto} />
            </div>
          </div>
          {/* Тип */}
          <div>
            <p className="text-xs font-semibold text-slate-500 mb-2 uppercase tracking-wide">Тип сделки</p>
            <div className="flex gap-2">
              {[['sale','Продажа'],['rent','Аренда']].map(([v,l]) => (
                <button key={v} onClick={() => set('deal_type', v)}
                  className={`flex-1 py-2.5 rounded-2xl text-sm font-semibold border ${form.deal_type === v ? 'bg-blue-600 text-white border-blue-600' : 'border-slate-200 text-slate-600'}`}>{l}</button>
              ))}
            </div>
          </div>
          {/* Поля */}
          {[['city','Город *'],['district','Район'],['street','Улица, дом']].map(([k,l]) => (
            <div key={k}>
              <p className="text-xs font-semibold text-slate-500 mb-2 uppercase tracking-wide">{l}</p>
              <input value={(form as Record<string,string>)[k]} onChange={e => set(k, e.target.value)}
                className="w-full bg-slate-50 border border-slate-200 rounded-2xl px-4 py-3 text-sm outline-none focus:border-blue-500" />
            </div>
          ))}
          <div className="flex gap-3">
            <div className="flex-1">
              <p className="text-xs font-semibold text-slate-500 mb-2 uppercase tracking-wide">Комнат</p>
              <input value={form.rooms} onChange={e => set('rooms', e.target.value)} type="number"
                className="w-full bg-slate-50 border border-slate-200 rounded-2xl px-4 py-3 text-sm outline-none focus:border-blue-500" />
            </div>
            <div className="flex-1">
              <p className="text-xs font-semibold text-slate-500 mb-2 uppercase tracking-wide">Площадь (м²)</p>
              <input value={form.area} onChange={e => set('area', e.target.value)} type="number"
                className="w-full bg-slate-50 border border-slate-200 rounded-2xl px-4 py-3 text-sm outline-none focus:border-blue-500" />
            </div>
          </div>
          <div>
            <p className="text-xs font-semibold text-slate-500 mb-2 uppercase tracking-wide">Цена (₽) *</p>
            <input value={form.price} onChange={e => set('price', e.target.value)} type="number"
              className="w-full bg-slate-50 border border-slate-200 rounded-2xl px-4 py-3 text-sm outline-none focus:border-blue-500" />
          </div>
          <div>
            <p className="text-xs font-semibold text-slate-500 mb-2 uppercase tracking-wide">Описание</p>
            <textarea value={form.description} onChange={e => set('description', e.target.value)} maxLength={500} rows={3}
              className="w-full bg-slate-50 border border-slate-200 rounded-2xl px-4 py-3 text-sm outline-none focus:border-blue-500 resize-none" />
          </div>
          <div>
            <p className="text-xs font-semibold text-slate-500 mb-2 uppercase tracking-wide">Телефон</p>
            <input value={form.phone} onChange={e => set('phone', e.target.value)} type="tel"
              className="w-full bg-slate-50 border border-slate-200 rounded-2xl px-4 py-3 text-sm outline-none focus:border-blue-500" />
          </div>
          <button onClick={save} disabled={saving || !form.city || !form.price}
            className="w-full py-4 rounded-2xl bg-blue-600 text-white font-bold text-base disabled:opacity-40 mb-4">
            {saving ? 'Сохраняем...' : 'Сохранить изменения'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Карточка объявления ───────────────────────────────────────────────────────
function RealtyCard({ listing: l, user, onClose, onOpenChat, onDeleted }: { listing: RealtyListing; user: User; onClose: () => void; onOpenChat: (chatId: number, listing: RealtyListing) => void; onDeleted?: () => void }) {
  const [photoIdx, setPhotoIdx] = useState(0);
  const [fullPhoto, setFullPhoto] = useState(false);
  const [opening, setOpening] = useState(false);
  const [saved, setSaved] = useState(false);
  const [savingFav, setSavingFav] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [showEdit, setShowEdit] = useState(false);
  const photos = l.photos && l.photos.length > 0 ? l.photos : [];

  useEffect(() => {
    api(`realty_fav_check&user_id=${user.id}&listing_id=${l.id}`).then(d => setSaved(!!d.saved));
  }, [l.id, user.id]);

  const toggleFav = async (e: React.MouseEvent) => {
    e.stopPropagation();
    setSavingFav(true);
    const d = await api('realty_fav_toggle', 'POST', { user_id: user.id, listing_id: l.id });
    setSaved(!!d.saved);
    setSavingFav(false);
  };

  const deleteListing = async () => {
    setDeleting(true);
    await api('realty_delete', 'POST', { user_id: user.id, listing_id: l.id });
    setDeleting(false);
    onClose();
    onDeleted?.();
  };

  // свайп по фото
  const swipeRef = useRef<{ x: number } | null>(null);
  const onPhotoTouchStart = (e: React.TouchEvent) => { swipeRef.current = { x: e.touches[0].clientX }; };
  const onPhotoTouchEnd = (e: React.TouchEvent) => {
    if (!swipeRef.current) return;
    const dx = e.changedTouches[0].clientX - swipeRef.current.x;
    if (dx < -40 && photoIdx < photos.length - 1) setPhotoIdx(i => i + 1);
    if (dx > 40 && photoIdx > 0) setPhotoIdx(i => i - 1);
    swipeRef.current = null;
  };

  const openChat = async () => {
    if (l.seller_id === user.id) return;
    setOpening(true);
    const d = await api('realty_open_chat', 'POST', { listing_id: l.id, buyer_id: user.id });
    setOpening(false);
    onClose();
    onOpenChat(d.chat_id as number, l);
  };

  return (
    <>
      <div className="fixed inset-0 z-50 bg-black/40 flex items-end" onClick={onClose}>
        <div className="bg-white rounded-t-3xl w-full max-h-[92vh] flex flex-col" onClick={e => e.stopPropagation()}>

          {/* Галерея со свайпом */}
          <div className="relative shrink-0 h-60 bg-slate-100 overflow-hidden rounded-t-3xl cursor-pointer"
            onTouchStart={onPhotoTouchStart} onTouchEnd={onPhotoTouchEnd}
            onClick={() => photos.length > 0 && setFullPhoto(true)}>
            {photos.length > 0
              ? <img src={photos[photoIdx]} alt="" className="w-full h-full object-cover" />
              : <div className="w-full h-full flex items-center justify-center text-6xl">🏠</div>
            }
            {/* Счётчик фото */}
            {photos.length > 1 && (
              <div className="absolute top-4 right-14 bg-black/50 text-white text-xs font-semibold px-2.5 py-1 rounded-full">
                {photoIdx + 1}/{photos.length}
              </div>
            )}
            {/* Точки */}
            {photos.length > 1 && (
              <div className="absolute bottom-3 left-0 right-0 flex justify-center gap-1.5">
                {photos.map((_,i) => (
                  <div key={i} onClick={e => { e.stopPropagation(); setPhotoIdx(i); }}
                    className={`w-2 h-2 rounded-full transition-all ${i === photoIdx ? 'bg-white scale-125' : 'bg-white/50'}`} />
                ))}
              </div>
            )}
            <button onClick={e => { e.stopPropagation(); onClose(); }}
              className="absolute top-4 right-4 w-9 h-9 rounded-full bg-black/40 flex items-center justify-center">
              <Icon name="X" size={18} className="text-white" />
            </button>
            {l.is_paid && <div className="absolute top-4 left-4 bg-green-500 text-white text-xs font-bold px-2.5 py-1 rounded-full">✅ Оплачено</div>}
            {photos.length > 0 && (
              <div className="absolute bottom-8 right-4 w-8 h-8 rounded-full bg-black/40 flex items-center justify-center">
                <Icon name="Maximize2" size={14} className="text-white" />
              </div>
            )}
          </div>

          <div className="overflow-y-auto flex-1 px-5 py-4 space-y-4">
            <div className="flex items-start justify-between gap-2">
              <div>
                <p className="text-3xl font-bold text-slate-900">{fmtPrice(l.price)}</p>
                {l.deal_type === 'rent' && <p className="text-sm text-slate-400">в месяц</p>}
              </div>
              <div className="flex items-center gap-2">
                <span className={`text-xs font-bold px-3 py-1.5 rounded-full ${l.deal_type === 'sale' ? 'bg-blue-100 text-blue-700' : 'bg-green-100 text-green-700'}`}>
                  {l.deal_type === 'sale' ? 'Продажа' : 'Аренда'}
                </span>
                {/* Избранное */}
                <button onClick={toggleFav} disabled={savingFav}
                  className={`w-10 h-10 rounded-full flex items-center justify-center transition-all ${saved ? 'bg-red-50 text-red-500' : 'bg-slate-100 text-slate-400'}`}>
                  <span className="text-lg">{saved ? '❤️' : '🤍'}</span>
                </button>
              </div>
            </div>

            <div className="flex gap-3 flex-wrap">
              {l.rooms && <div className="bg-slate-100 rounded-2xl px-3 py-2 text-sm font-semibold text-slate-700">{l.rooms} комн.</div>}
              {l.area && <div className="bg-slate-100 rounded-2xl px-3 py-2 text-sm font-semibold text-slate-700">{l.area} м²</div>}
            </div>

            <div className="flex items-start gap-2 text-slate-600">
              <Icon name="MapPin" size={16} className="text-blue-500 mt-0.5 shrink-0" />
              <p className="text-sm">{[l.city, l.district, l.street].filter(Boolean).join(', ')}</p>
            </div>

            {l.description && <p className="text-sm text-slate-600 leading-relaxed">{l.description}</p>}

            <div className="flex items-center gap-3 py-3 border-t border-slate-100">
              <Avatar url={l.seller_avatar} nick={l.seller_nick} size={40} />
              <div>
                <p className="font-semibold text-sm text-slate-800">@{l.seller_nick}</p>
                <p className="text-xs text-slate-400">Продавец</p>
              </div>
            </div>

            {/* Телефон — всегда виден если есть */}
            {l.phone && (
              <div className="bg-slate-50 border border-slate-200 rounded-2xl p-4 flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-full bg-green-100 flex items-center justify-center">
                    <Icon name="Phone" size={18} className="text-green-600" />
                  </div>
                  <div>
                    <p className="text-xs text-slate-400 mb-0.5">Телефон продавца</p>
                    <p className="font-bold text-slate-900 text-base">{l.phone}</p>
                  </div>
                </div>
                <a href={`tel:${l.phone}`} onClick={e => e.stopPropagation()}
                  className="bg-green-500 text-white text-sm font-semibold px-4 py-2 rounded-xl flex items-center gap-1.5 active:bg-green-600">
                  <Icon name="Phone" size={14} /> Позвонить
                </a>
              </div>
            )}

            {/* Кнопки действий */}
            <div className="pb-4 space-y-2">
              {l.seller_id !== user.id && (
                <button onClick={openChat} disabled={opening}
                  className="w-full py-3.5 rounded-2xl bg-blue-600 text-white font-bold flex items-center justify-center gap-2 disabled:opacity-50">
                  <Icon name="MessageCircle" size={18} />
                  {opening ? 'Открываем...' : 'Написать продавцу'}
                </button>
              )}
              {/* Кнопка редактирования — только для владельца */}
              {l.seller_id === user.id && (
                <button onClick={() => setShowEdit(true)}
                  className="w-full py-3.5 rounded-2xl border border-blue-200 text-blue-600 font-semibold flex items-center justify-center gap-2 hover:bg-blue-50 transition-colors">
                  <Icon name="Pencil" size={18} /> Редактировать
                </button>
              )}
              {/* Кнопка удаления — только для владельца */}
              {l.seller_id === user.id && (
                <button onClick={() => setConfirmDelete(true)}
                  className="w-full py-3.5 rounded-2xl border border-red-200 text-red-500 font-semibold flex items-center justify-center gap-2 hover:bg-red-50 transition-colors">
                  <Icon name="Trash2" size={18} /> Удалить объявление
                </button>
              )}
            </div>

            {/* Подтверждение удаления */}
            {confirmDelete && (
              <div className="fixed inset-0 z-[110] bg-black/50 flex items-center justify-center px-6" onClick={() => setConfirmDelete(false)}>
                <div className="bg-white rounded-3xl p-6 w-full max-w-sm space-y-4" onClick={e => e.stopPropagation()}>
                  <div className="text-center">
                    <div className="text-4xl mb-3">🗑️</div>
                    <p className="font-bold text-lg text-slate-900">Удалить объявление?</p>
                    <p className="text-sm text-slate-500 mt-1">Объявление исчезнет из ленты и из избранного у всех пользователей.</p>
                  </div>
                  <button onClick={deleteListing} disabled={deleting}
                    className="w-full py-3.5 rounded-2xl bg-red-500 text-white font-bold disabled:opacity-50">
                    {deleting ? 'Удаляем...' : 'Да, удалить'}
                  </button>
                  <button onClick={() => setConfirmDelete(false)}
                    className="w-full py-3 rounded-2xl text-slate-500 font-medium">
                    Отмена
                  </button>
                </div>
              </div>
            )}
            {/* Форма редактирования */}
            {showEdit && (
              <RealtyEditForm listing={l} user={user} onClose={() => setShowEdit(false)} onSaved={() => { setShowEdit(false); onDeleted?.(); }} />
            )}
          </div>
        </div>
      </div>

      {/* Полноэкранный просмотр фото */}
      {fullPhoto && photos.length > 0 && (
        <div className="fixed inset-0 z-[100] bg-black flex flex-col"
          onTouchStart={onPhotoTouchStart} onTouchEnd={onPhotoTouchEnd}>
          <div className="flex items-center justify-between px-4 pb-2"
            style={{ paddingTop: 'calc(env(safe-area-inset-top) + 12px)' }}>
            <button onClick={() => setFullPhoto(false)}
              className="w-10 h-10 rounded-full bg-white/20 flex items-center justify-center">
              <Icon name="X" size={22} className="text-white" />
            </button>
            <span className="text-white font-semibold">{photoIdx + 1} / {photos.length}</span>
            <div className="w-10" />
          </div>
          <div className="flex-1 flex items-center justify-center px-2">
            <img src={photos[photoIdx]} alt="" className="max-w-full max-h-full object-contain rounded-xl" />
          </div>
          {/* Стрелки */}
          <div className="flex justify-between px-4 py-6 gap-4">
            <button onClick={() => setPhotoIdx(i => Math.max(0, i-1))} disabled={photoIdx === 0}
              className="flex-1 py-3 rounded-2xl bg-white/15 text-white font-semibold disabled:opacity-30 flex items-center justify-center gap-2">
              <Icon name="ChevronLeft" size={20} /> Пред.
            </button>
            <button onClick={() => setPhotoIdx(i => Math.min(photos.length-1, i+1))} disabled={photoIdx === photos.length-1}
              className="flex-1 py-3 rounded-2xl bg-white/15 text-white font-semibold disabled:opacity-30 flex items-center justify-center gap-2">
              След. <Icon name="ChevronRight" size={20} />
            </button>
          </div>
          {/* Точки */}
          {photos.length > 1 && (
            <div className="flex justify-center gap-2 pb-8">
              {photos.map((_,i) => (
                <button key={i} onClick={() => setPhotoIdx(i)}
                  className={`w-2.5 h-2.5 rounded-full transition-all ${i === photoIdx ? 'bg-white scale-125' : 'bg-white/40'}`} />
              ))}
            </div>
          )}
        </div>
      )}
    </>
  );
}

// ── Чат по объявлению ─────────────────────────────────────────────────────────
function RealtyChatScreen({ user, chatId, listing, onBack }: { user: User; chatId: number; listing: RealtyListing; onBack: () => void }) {
  const [messages, setMessages] = useState<{ id: number; sender_id: number; sender_nick: string; sender_avatar?: string|null; text: string; created_at: string }[]>([]);
  const [input, setInput] = useState('');
  const [confirmDeleteChat, setConfirmDeleteChat] = useState(false);
  const lastIdRef = useRef(0);
  const scrollRef = useRef<HTMLDivElement>(null);

  const load = async () => {
    const d = await api(`realty_messages&chat_id=${chatId}&after=${lastIdRef.current}`);
    const fresh = (d.messages as typeof messages) || [];
    if (fresh.length) { lastIdRef.current = fresh[fresh.length - 1].id; setMessages(m => [...m, ...fresh]); }
  };

  useEffect(() => {
    load();
    const iv = setInterval(() => { if (!document.hidden) load(); }, 2000);
    return () => clearInterval(iv);
  }, [chatId]);

  useEffect(() => { scrollRef.current?.scrollTo(0, scrollRef.current.scrollHeight); }, [messages]);

  const send = async () => {
    const t = input.trim(); if (!t) return;
    setInput('');
    await api('realty_send', 'POST', { chat_id: chatId, user_id: user.id, text: t });
    load();
  };

  return (
    <div className="fixed inset-0 flex flex-col bg-slate-50">
      {/* Header */}
      <header className="shrink-0 flex items-center gap-2 px-2 bg-blue-600"
        style={{ paddingTop: 'calc(env(safe-area-inset-top) + 6px)', paddingBottom: '12px', borderRadius: '0 0 18px 18px', boxShadow: '0 4px 20px rgba(37,99,235,0.35)', zIndex: 10 }}>
        <button onClick={onBack} className="w-10 h-10 rounded-full hover:bg-white/15 flex items-center justify-center">
          <Icon name="ArrowLeft" size={22} className="text-white" />
        </button>
        <div className="flex-1 min-w-0">
          <p className="font-bold text-white text-[15px] truncate">{listing.city} · {fmtPrice(listing.price)}</p>
          <p className="text-blue-200 text-xs truncate">{[listing.rooms ? `${listing.rooms} комн.` : null, listing.area ? `${listing.area}м²` : null].filter(Boolean).join(' · ')}</p>
        </div>
        <button onClick={() => setConfirmDeleteChat(true)}
          className="w-10 h-10 rounded-full hover:bg-white/15 flex items-center justify-center">
          <Icon name="Trash2" size={18} className="text-white/70" />
        </button>
      </header>

      {/* Сообщения */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto px-3 py-4 space-y-2">
        {messages.length === 0 && (
          <div className="text-center mt-12">
            <div className="text-4xl mb-3">🏠</div>
            <p className="text-sm text-slate-400">Начните переписку по объявлению</p>
          </div>
        )}
        {messages.map(m => {
          const mine = m.sender_id === user.id;
          return (
            <div key={m.id} className={`flex ${mine ? 'justify-end' : 'justify-start'}`}>
              <div className={`max-w-[78%] px-4 py-2.5 rounded-2xl text-[15px] ${mine ? 'bg-blue-600 text-white rounded-br-sm' : 'bg-white text-slate-800 rounded-bl-sm shadow-sm border border-slate-100'}`}>
                {!mine && <p className="text-xs font-semibold text-blue-500 mb-1">@{m.sender_nick}</p>}
                <p className="leading-relaxed break-words">{m.text}</p>
                <p className={`text-[10px] mt-1 text-right ${mine ? 'text-white/60' : 'text-slate-400'}`}>{new Date(m.created_at).toLocaleTimeString('ru-RU',{hour:'2-digit',minute:'2-digit'})}</p>
              </div>
            </div>
          );
        })}
      </div>

      {/* Ввод */}
      <div className="shrink-0 px-3 py-3 bg-white border-t border-slate-100"
        style={{ paddingBottom: 'calc(env(safe-area-inset-bottom) + 12px)' }}>
        <div className="flex items-center gap-2 bg-slate-100 rounded-2xl px-4 py-2">
          <input value={input} onChange={e => setInput(e.target.value)} onKeyDown={e => e.key === 'Enter' && send()}
            placeholder="Написать сообщение..." className="flex-1 bg-transparent outline-none text-sm text-slate-800" />
          <button onClick={send} disabled={!input.trim()}
            className="w-9 h-9 rounded-full bg-blue-600 flex items-center justify-center disabled:opacity-40 transition-opacity shrink-0">
            <Icon name="Send" size={16} className="text-white" />
          </button>
        </div>
      </div>

      {/* Подтверждение удаления чата */}
      {confirmDeleteChat && (
        <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center px-6">
          <div className="bg-white rounded-3xl p-6 w-full max-w-sm space-y-4">
            <div className="text-center">
              <div className="text-4xl mb-3">🗑️</div>
              <p className="font-bold text-lg text-slate-900">Удалить чат?</p>
              <p className="text-sm text-slate-500 mt-1">История переписки по этому объявлению исчезнет у тебя.</p>
            </div>
            <button onClick={async () => { await api('realty_delete_chat', 'POST', { chat_id: chatId, user_id: user.id }); onBack(); }}
              className="w-full py-3.5 rounded-2xl bg-red-500 text-white font-bold">
              Да, удалить
            </button>
            <button onClick={() => setConfirmDeleteChat(false)}
              className="w-full py-3 rounded-2xl text-slate-500 font-medium">
              Отмена
            </button>
          </div>
        </div>
      )}
    </div>
  );
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

type Reaction = { emoji: string; user_id: number };
type MsgExt = Message & { reactions?: Reaction[]; is_removed?: boolean; media_type?: string; media_url?: string };

function ChatScreen({ user, chatId, peer, groupName, groupId, groupPhotoUrl, onBack, onOpenProfile, onOpenGroup, autoCall, onCallStarted }: {
  user: User; chatId: number; peer?: User; groupName?: string; groupId?: number; groupPhotoUrl?: string | null;
  onBack: () => void; onOpenProfile: (id: number) => void; onOpenGroup: (gid: number, chatId: number) => void;
  autoCall?: { kind: 'audio' | 'video' } | null;
  onCallStarted?: () => void;
}) {
  const [messages, setMessages] = useState<MsgExt[]>([]);
  const [input, setInput] = useState('');
  const [typing, setTyping] = useState<string[]>([]);
  const [peerOnline, setPeerOnline] = useState(false);
  const [peerLastSeen, setPeerLastSeen] = useState<string | null>(null);
  const [selectedMsg, setSelectedMsg] = useState<number | null>(null);
  const [emojiTarget, setEmojiTarget] = useState<number | null>(null);
  const [showAttach, setShowAttach] = useState(false);
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
  const fileType = useRef<'image' | 'video' | 'audio'>('image');
  const recordTimer = useRef<ReturnType<typeof setInterval> | null>(null);
  const cancelFlag = useRef(false);

  const poll = useCallback(async () => {
    const d = await api(`chat_poll&chat_id=${chatId}&after=${lastIdRef.current}&user_id=${user.id}&peer_id=${peer?.id || 0}`);
    const fresh: MsgExt[] = d.messages || [];
    if (fresh.length) { lastIdRef.current = fresh[fresh.length - 1].id; setMessages(m => [...m, ...fresh]); }
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
    poll();
    const iv = setInterval(() => { if (!document.hidden) poll(); }, 1500);
    const onVisible = () => { if (!document.hidden) poll(); };
    document.addEventListener('visibilitychange', onVisible);
    return () => { clearInterval(iv); document.removeEventListener('visibilitychange', onVisible); };
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
    const t = text ?? input.trim();
    if (!t && !media_url) return;
    if (!text) setInput('');
    if (typingTimer.current) clearTimeout(typingTimer.current);
    await api('send', 'POST', { chat_id: chatId, user_id: user.id, text: t || null, media_url: media_url || null, media_type: media_type || null });
    // После отправки своего сообщения — всегда скроллим вниз
    isAtBottomRef.current = true;
    setTimeout(() => {
      const el = scrollRef.current;
      if (el) el.scrollTop = el.scrollHeight;
    }, 50);
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

  const uploadFile = async (file: File, type: 'image' | 'video' | 'audio' | 'voice') => {
    const maxMb = type === 'video' ? 200 : type === 'audio' ? 50 : 20;
    if (file.size > maxMb * 1024 * 1024) {
      alert(`Файл слишком большой. Максимум ${maxMb} МБ.`);
      return;
    }
    setUploading(true);
    const label = type === 'video' ? 'Загрузка видео...' : type === 'audio' ? 'Загрузка аудио...' : type === 'image' ? 'Загрузка фото...' : 'Загрузка...';
    setUploadProgress(label);
    try {
      const ext = (file.name.split('.').pop() || (type === 'voice' ? 'ogg' : type === 'image' ? 'jpg' : type)).toLowerCase();
      // Видео и аудио — грузим напрямую в S3 через presigned URL (без ограничения размера)
      if (type === 'video' || type === 'audio') {
        const d = await api('get_upload_url', 'POST', { user_id: user.id, ext, media_type: type });
        if (!d.upload_url) throw new Error('Нет upload_url');
        await fetch(d.upload_url, {
          method: 'PUT',
          body: file,
          headers: { 'Content-Type': file.type || `${type}/${ext}` },
        });
        await send(undefined, d.cdn_url, type);
      } else {
        // Фото и прочее — через base64 как раньше
        const b64 = await new Promise<string>((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => resolve((reader.result as string).split(',')[1]);
          reader.onerror = reject;
          reader.readAsDataURL(file);
        });
        const d = await api('upload_media', 'POST', { user_id: user.id, data: b64, ext, media_type: type });
        if (d.url) await send(undefined, d.url, type);
      }
    } catch (e) {
      console.error('[uploadFile]', e);
      alert('Не удалось загрузить файл. Попробуй ещё раз.');
    } finally {
      setUploading(false);
      setUploadProgress('');
    }
  };

  const pickFile = (type: 'image' | 'video' | 'audio') => {
    fileType.current = type;
    setShowAttach(false);
    if (fileRef.current) {
      fileRef.current.accept = type === 'image' ? 'image/*' : type === 'video' ? 'video/*' : 'audio/*';
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
    : groupName ? 'Группа'
    : peerOnline ? 'в сети'
    : peerLastSeen ? fmtLastSeen(peerLastSeen)
    : '';
  const subtitleColor = peerOnline && !groupName && typing.length === 0 ? 'text-green-300' : 'text-blue-200';

  return (
    <div className="fixed inset-0 flex flex-col" style={{ background: 'var(--chat-bg, #e8eef7)' }} onClick={() => { setSelectedMsg(null); setEmojiTarget(null); setShowAttach(false); }}>
      {/* Header — Telegram стиль: скруглён снизу, тень */}
      <header className="shrink-0 flex items-center gap-1 px-1 bg-blue-600"
        style={{
          paddingTop: 'calc(env(safe-area-inset-top) + 6px)',
          paddingBottom: '12px',
          borderRadius: '0 0 18px 18px',
          boxShadow: '0 4px 20px rgba(37,99,235,0.35)',
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
            <div className="font-bold text-white text-[16px] truncate leading-tight">{title}</div>
            {typing.length > 0
              ? <div className="flex items-center gap-1 mt-[2px]">
                  <span className="text-[12px] text-blue-200">печатает</span>
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
        {messages.length === 0 && <p className="text-center text-muted-foreground text-sm mt-12">Напишите первое сообщение 👋</p>}
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
              {showNick && <span className="text-[11px] text-accent ml-10 mb-0.5">{m.sender_nick}</span>}
              <div className={`flex items-end gap-1.5 ${mine ? 'flex-row-reverse' : ''} max-w-[82%]`}>
                {!mine && groupName && <Avatar url={m.sender_avatar} nick={m.sender_nick} size={34} />}
                <div className="relative">
                  <div className={`px-4 py-2.5 ${mine ? 'msg-bubble-mine' : 'msg-bubble-peer'} ${isSelected ? 'ring-2 ring-blue-400' : ''}`}>
                    {m.is_removed
                      ? <p className="text-xs italic opacity-60">Сообщение удалено</p>
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
                                  <span className="text-[15px] underline underline-offset-2 break-all">{m.text || 'Файл'}</span>
                                </a>
                              : <p className="leading-relaxed break-words text-[15px]">{renderTextWithLinks(m.text || '', mine)}</p>
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
                    😊 Реакция
                  </button>
                  <button onClick={() => { openForward(m); setSelectedMsg(null); }}
                    className="glass rounded-full px-3 py-1.5 text-xs flex items-center gap-1 hover:bg-secondary/80">
                    <Icon name="Forward" size={12} /> Переслать
                  </button>
                  {mine && (
                    <>
                      <button onClick={() => deleteMsg(m.id, false)}
                        className="glass rounded-full px-3 py-1.5 text-xs flex items-center gap-1 hover:bg-secondary/80 text-muted-foreground">
                        <Icon name="Trash2" size={12} /> У меня
                      </button>
                      <button onClick={() => deleteMsg(m.id, true)}
                        className="glass rounded-full px-3 py-1.5 text-xs flex items-center gap-1 hover:bg-destructive/20 text-destructive">
                        <Icon name="Trash2" size={12} /> У всех
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
        style={{ paddingBottom: 'calc(env(safe-area-inset-bottom) + 10px)' }}
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
          <div className="flex items-center gap-3 px-4 py-3 bg-blue-50 border-t border-blue-100">
            <div className="w-5 h-5 border-2 border-blue-500 border-t-transparent rounded-full animate-spin shrink-0" />
            <span className="text-sm text-blue-600 font-medium">{uploadProgress}</span>
          </div>
        )}

        {/* Attach menu */}
        {showAttach && !recording && (
          <div className="flex gap-2 mb-3 animate-fade-up">
            {[
              { icon: 'Image', label: 'Фото', type: 'image' as const },
              { icon: 'Video', label: 'Видео', type: 'video' as const },
              { icon: 'Music', label: 'Аудио', type: 'audio' as const },
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
              <span className="text-[10px] text-slate-500 font-medium">Файл</span>
            </button>
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
              <span className="text-sm font-medium text-destructive">Запись…</span>
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
            <button onClick={() => setShowAttach(v => !v)}
              className={`w-10 h-10 shrink-0 rounded-full flex items-center justify-center transition-colors ${showAttach ? 'bg-blue-100 text-blue-600' : 'text-slate-500 hover:bg-slate-100'}`}>
              <Icon name="Paperclip" size={22} />
            </button>
            <div className="flex-1 flex items-center bg-white border border-slate-200 rounded-full px-4 gap-2 shadow-sm">
              <input value={input} onChange={e => handleInput(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && !e.shiftKey && send()}
                placeholder="Сообщение"
                className="flex-1 bg-transparent outline-none py-2.5 text-sm text-slate-800 placeholder:text-slate-400" />
              {!input.trim() && (
                <button className="shrink-0 text-slate-400">
                  <Icon name="Smile" size={20} />
                </button>
              )}
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
              <h3 className="font-bold text-slate-800">Прочитали</h3>
              <button onClick={() => setReadByMsg(null)}><Icon name="X" size={20} className="text-slate-400" /></button>
            </div>
            <div className="overflow-y-auto flex-1 py-2">
              {readByMsg.readers.length === 0
                ? <p className="text-center text-slate-400 text-sm py-8">Никто ещё не прочитал</p>
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
              <h3 className="font-bold text-slate-800 dark:text-white">Переслать в чат</h3>
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
    <div className="fixed inset-0 flex flex-col" style={{ background: '#f0f4fa' }}>
      <header className="flex items-center gap-3 px-4 bg-blue-600 shrink-0"
        style={{ paddingTop: 'calc(env(safe-area-inset-top) + 6px)', paddingBottom: '12px', borderRadius: '0 0 18px 18px', boxShadow: '0 4px 20px rgba(37,99,235,0.35)', zIndex: 10 }}>
        <button onClick={onBack} className="w-9 h-9 rounded-full hover:bg-white/15 flex items-center justify-center transition-colors">
          <Icon name="ArrowLeft" size={20} className="text-white" />
        </button>
        <span className="font-bold text-white flex-1">Новая группа</span>
        <button onClick={create} disabled={!name.trim() || creating || selected.length === 0}
          className="px-5 py-2 rounded-xl bg-white text-blue-600 text-sm font-bold disabled:opacity-40 transition-all active:scale-95">
          {creating ? '...' : 'Создать'}
        </button>
      </header>

      <div className="flex-1 overflow-y-auto scrollbar-thin p-4 space-y-4">
        {/* Название */}
        <div className="bg-white rounded-2xl p-4 border border-slate-100">
          <label className="text-xs font-semibold text-slate-500 mb-2 block">Название группы</label>
          <input value={name} onChange={e => setName(e.target.value)} placeholder="Моя группа" autoFocus
            className="w-full bg-slate-50 border-2 border-slate-200 rounded-xl px-4 py-3 outline-none focus:border-blue-500 transition-all text-slate-800 text-sm" />
        </div>

        {/* Выбранные участники */}
        {selected.length > 0 && (
          <div className="bg-white rounded-2xl p-4 border border-slate-100">
            <p className="text-xs font-semibold text-slate-500 mb-3">Участники: {selected.length}</p>
            <div className="flex gap-2 flex-wrap">
              {selected.map(u => (
                <div key={u.id} className="flex items-center gap-1.5 bg-blue-50 border border-blue-100 rounded-full pl-1.5 pr-3 py-1">
                  <Avatar url={u.avatar_url} nick={u.nick} size={20} />
                  <span className="text-xs font-semibold text-blue-700">@{u.nick}</span>
                  <button onClick={() => toggle(u)} className="ml-0.5 text-blue-400 hover:text-red-400">
                    <Icon name="X" size={12} />
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Список подписок */}
        <div className="bg-white rounded-2xl border border-slate-100 overflow-hidden">
          <div className="px-4 pt-4 pb-2">
            <p className="text-xs font-semibold text-slate-500 mb-3">Подписки ({followers.length})</p>
            {followers.length > 3 && (
              <div className="relative mb-3">
                <Icon name="Search" size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                <input value={q} onChange={e => setQ(e.target.value)} placeholder="Поиск…"
                  className="w-full bg-slate-50 border border-slate-200 rounded-xl pl-9 pr-4 py-2.5 outline-none focus:border-blue-500 transition-all text-sm" />
              </div>
            )}
          </div>
          {followers.length === 0 && (
            <div className="flex flex-col items-center py-8 gap-2">
              <Icon name="Users" size={32} className="text-slate-200" />
              <p className="text-sm text-slate-400">Нет подписок. Найди людей через поиск.</p>
            </div>
          )}
          {filtered.map(u => (
            <button key={u.id} onClick={() => toggle(u)}
              className="w-full flex items-center gap-3 px-4 py-3 hover:bg-blue-50 transition-colors border-t border-slate-50">
              <Avatar url={u.avatar_url} nick={u.nick} size={40} online={u.is_online} />
              <span className="flex-1 text-left font-semibold text-slate-800 text-sm">@{u.nick}</span>
              <div className={`w-6 h-6 rounded-full border-2 flex items-center justify-center transition-all ${selected.find(x => x.id === u.id) ? 'bg-blue-600 border-blue-600' : 'border-slate-300'}`}>
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
// GROUP INFO SCREEN
// ══════════════════════════════════════════════════════════════════════════════
function GroupInfoScreen({ user, groupId, chatId, onBack, onOpenChat, onOpenProfile }: {
  user: User; groupId: number; chatId: number;
  onBack: () => void; onOpenChat: (name: string, photoUrl?: string | null) => void; onOpenProfile: (id: number) => void;
}) {
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
      alert('Не удалось загрузить фото. Попробуй ещё раз.');
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

  const roleLabel: Record<string, string> = { owner: '👑 Владелец', admin: '⭐ Админ', member: 'Участник' };
  const filteredInvitable = inviteQ.trim()
    ? invitable.filter(u => u.nick.toLowerCase().includes(inviteQ.toLowerCase()))
    : invitable;

  if (!group) return (
    <div className="min-h-screen flex items-center justify-center" style={{ background: '#f0f4fa' }}>
      <div className="w-8 h-8 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
    </div>
  );

  const isPublic = group.is_public !== false;

  return (
    <div className="fixed inset-0 flex flex-col" style={{ background: '#f0f4fa' }} onClick={() => { setShowPhotoMenu(false); setShowInvite(false); }}>
      <header className="flex items-center gap-3 px-4 bg-blue-600 shrink-0" onClick={e => e.stopPropagation()}
        style={{ paddingTop: 'calc(env(safe-area-inset-top) + 6px)', paddingBottom: '12px', borderRadius: '0 0 18px 18px', boxShadow: '0 4px 20px rgba(37,99,235,0.35)', zIndex: 10 }}>
        <button onClick={onBack} className="w-9 h-9 rounded-xl hover:bg-blue-500 flex items-center justify-center transition-colors">
          <Icon name="ArrowLeft" size={20} className="text-white" />
        </button>
        <span className="font-bold text-white flex-1">Группа</span>
        <button onClick={() => onOpenChat(group?.name || '', group?.photo_url)} className="px-4 py-2 rounded-xl bg-white text-blue-600 text-sm font-bold transition-all active:scale-95">
          <Icon name="MessageCircle" size={15} className="inline mr-1" />Чат
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
              className="font-bold text-2xl mt-4 text-center text-slate-800 bg-transparent outline-none border-b-2 border-transparent focus:border-blue-400 transition-colors px-2 w-full max-w-xs"
            />
          ) : (
            <h2 className="font-display font-bold text-2xl mt-4">{group.name}</h2>
          )}

          {/* Описание (редактируемое) */}
          {isAdmin ? (
            <textarea
              value={editAbout}
              onChange={e => setEditAbout(e.target.value)}
              onBlur={() => editAbout !== (group.about || '') && saveField({ about: editAbout || null })}
              rows={2}
              placeholder="О группе — нажми чтобы добавить"
              className="text-sm text-slate-500 mt-2 text-center bg-transparent outline-none border-b-2 border-transparent focus:border-blue-400 transition-colors resize-none w-full max-w-xs placeholder:text-slate-300"
            />
          ) : (
            group.about && <p className="text-sm text-slate-500 mt-2 text-center">{group.about}</p>
          )}

          <p className="text-xs text-slate-400 mt-2">
            {isPublic ? '🌐 Публичная' : '🔒 Закрытая'} · {group.member_count} участников
          </p>
          {saving && <p className="text-xs text-blue-500 mt-1">Сохраняю...</p>}
        </div>

        {/* ── Настройки (только для админа) ── */}
        {isAdmin && (
          <div className="mx-4 mb-3 bg-white rounded-2xl overflow-hidden border border-slate-100">
            <div className="flex items-center justify-between px-4 py-3.5 border-b border-slate-100">
              <div>
                <p className="text-sm font-semibold text-slate-800">{isPublic ? 'Публичная группа' : 'Закрытая группа'}</p>
                <p className="text-xs text-slate-400">{isPublic ? 'Любой может вступить по ссылке' : 'Только по приглашению'}</p>
              </div>
              <button onClick={() => saveField({ is_public: !isPublic })}
                className={`relative w-11 h-6 rounded-full transition-colors ${isPublic ? 'bg-blue-600' : 'bg-slate-200'}`}>
                <span className={`absolute top-0.5 w-5 h-5 rounded-full bg-white shadow transition-transform ${isPublic ? 'translate-x-5' : 'translate-x-0.5'}`} />
              </button>
            </div>
            <div className="px-4 py-3.5">
              <p className="text-xs text-slate-400 mb-2">Ссылка-приглашение</p>
              <button onClick={copyLink}
                className="w-full py-2.5 rounded-xl bg-blue-600 text-white text-sm font-bold transition-all active:scale-[0.98]">
                <Icon name={copied ? 'Check' : 'Link'} size={14} className="inline mr-1.5" />
                {copied ? 'Скопировано!' : 'Скопировать ссылку'}
              </button>
            </div>
          </div>
        )}

        {/* Ссылка для не-админа */}
        {!isAdmin && (
          <div className="mx-4 mb-3">
            <button onClick={copyLink}
              className="w-full py-2.5 rounded-2xl bg-white border border-slate-200 text-slate-700 text-sm font-medium flex items-center justify-center gap-2">
              <Icon name={copied ? 'Check' : 'Link'} size={14} className="text-blue-500" />
              {copied ? 'Скопировано!' : 'Скопировать ссылку'}
            </button>
          </div>
        )}

        {/* ── Участники ── */}
        <div className="mx-4 mb-3">
          <div className="flex items-center justify-between mb-2 px-1">
            <p className="text-xs text-slate-400 font-semibold uppercase tracking-wider">Участники · {group.member_count}</p>
            {isAdmin && invitable.length > 0 && (
              <button onClick={e => { e.stopPropagation(); setShowInvite(v => !v); }}
                className="flex items-center gap-1 text-xs text-blue-600 font-semibold">
                <Icon name="UserPlus" size={14} /> Пригласить
              </button>
            )}
          </div>

          {showInvite && (
            <div className="bg-white rounded-2xl p-3 mb-3 border border-slate-100" onClick={e => e.stopPropagation()}>
              <p className="text-xs text-slate-400 mb-2 font-medium">Выбери из подписок:</p>
              {invitable.length > 4 && (
                <input value={inviteQ} onChange={e => setInviteQ(e.target.value)} placeholder="Поиск..."
                  className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-sm outline-none focus:border-blue-500 mb-2" />
              )}
              <div className="max-h-48 overflow-y-auto space-y-1">
                {filteredInvitable.map(u => (
                  <button key={u.id} onClick={() => addMember(u.id)}
                    className="w-full flex items-center gap-3 px-3 py-2 rounded-xl hover:bg-blue-50 transition-colors">
                    <Avatar url={u.avatar_url} nick={u.nick} size={32} online={u.is_online} />
                    <span className="flex-1 text-left text-sm font-medium text-slate-800">@{u.nick}</span>
                    <Icon name="Plus" size={16} className="text-blue-500 shrink-0" />
                  </button>
                ))}
                {filteredInvitable.length === 0 && (
                  <p className="text-xs text-slate-400 text-center py-3">Все подписки уже в группе</p>
                )}
              </div>
            </div>
          )}

          <div className="bg-white rounded-2xl overflow-hidden border border-slate-100">
            {members.map((m, i) => (
              <div key={m.id} className={`flex items-center gap-3 px-4 py-3 ${i < members.length - 1 ? 'border-b border-slate-50' : ''}`}>
                <button onClick={() => m.id !== user.id && onOpenProfile(m.id)} className="flex items-center gap-3 flex-1 min-w-0 text-left">
                  <Avatar url={m.avatar_url} nick={m.nick} size={40} online={m.is_online} />
                  <div className="flex-1 min-w-0">
                    <div className="font-semibold text-sm text-slate-800 truncate">@{m.nick}{m.id === user.id ? ' (вы)' : ''}</div>
                    <div className="text-xs text-slate-400">{roleLabel[m.role] || 'Участник'}</div>
                  </div>
                </button>
                {isAdmin && m.id !== user.id && (
                  <div className="flex gap-1 shrink-0">
                    {isOwner && m.role === 'member' && (
                      <button onClick={() => setRole(m.id, 'admin')} title="Назначить админом"
                        className="w-8 h-8 rounded-full hover:bg-yellow-50 flex items-center justify-center transition-colors">
                        <Icon name="Star" size={14} className="text-yellow-500" />
                      </button>
                    )}
                    {isOwner && m.role === 'admin' && (
                      <button onClick={() => setRole(m.id, 'member')} title="Снять права"
                        className="w-8 h-8 rounded-full hover:bg-slate-100 flex items-center justify-center transition-colors">
                        <Icon name="StarOff" size={14} className="text-slate-400" />
                      </button>
                    )}
                    {isOwner && (
                      <button onClick={() => setTransferTarget(m.id)} title="Передать владение"
                        className="w-8 h-8 rounded-full hover:bg-blue-50 flex items-center justify-center transition-colors">
                        <Icon name="Crown" size={14} className="text-blue-500" />
                      </button>
                    )}
                    <button onClick={() => setKickTarget(m.id)} title="Удалить из группы"
                      className="w-8 h-8 rounded-full hover:bg-red-50 flex items-center justify-center transition-colors">
                      <Icon name="UserX" size={14} className="text-red-400" />
                    </button>
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>

        {kickTarget && (
          <div className="mx-4 mb-3 bg-white rounded-2xl p-4 border border-slate-100">
            <p className="text-sm text-slate-700 mb-3">Удалить @{members.find(m => m.id === kickTarget)?.nick} из группы?</p>
            <div className="flex gap-2">
              <button onClick={() => kick(kickTarget)}
                className="flex-1 py-2.5 rounded-2xl bg-red-500 text-white text-sm font-semibold">Удалить</button>
              <button onClick={() => setKickTarget(null)}
                className="flex-1 py-2.5 rounded-2xl bg-slate-100 text-slate-600 text-sm font-medium">Отмена</button>
            </div>
          </div>
        )}

        {transferTarget && (
          <div className="mx-4 mb-3 bg-white rounded-2xl p-4 border border-slate-100">
            <p className="text-sm text-slate-700 mb-3">Передать владение @{members.find(m => m.id === transferTarget)?.nick}? Вы станете обычным участником.</p>
            <div className="flex gap-2">
              <button onClick={transfer}
                className="flex-1 py-2.5 rounded-2xl bg-blue-600 text-white text-sm font-semibold">Передать</button>
              <button onClick={() => setTransferTarget(null)}
                className="flex-1 py-2.5 rounded-2xl bg-slate-100 text-slate-600 text-sm font-medium">Отмена</button>
            </div>
          </div>
        )}

        {/* Покинуть группу */}
        <div className="mx-4">
          <button onClick={leave}
            className="w-full py-3.5 rounded-2xl text-red-500 hover:bg-red-50 transition-colors text-sm font-medium flex items-center justify-center gap-2">
            <Icon name="LogOut" size={16} />Покинуть группу
          </button>
        </div>
      </div>
    </div>
  );
}