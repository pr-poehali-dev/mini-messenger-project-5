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
type Tab = 'search' | 'chats' | 'notifications' | 'profile';
type Notif = { id: number; type: string; from_user_id?: number; from_nick?: string; from_avatar?: string | null; chat_id?: number; group_id?: number; payload?: string; is_read: boolean; created_at: string };
type GroupInfo = { id: number; name: string; about?: string; photo_url?: string | null; invite_token: string; owner_id: number; my_role?: string; member_count: number; is_public?: boolean };
type GroupMember = User & { role: string };

// ── screens ───────────────────────────────────────────────────────────────────
type Screen =
  | { name: 'login' }
  | { name: 'setup' }
  | { name: 'tabs'; tab: Tab }
  | { name: 'chat'; chatId: number; peer?: User; groupName?: string; groupId?: number }
  | { name: 'user_profile'; userId: number }
  | { name: 'followers'; userId: number; mode: 'followers' | 'following' }
  | { name: 'new_group' }
  | { name: 'group_info'; groupId: number; chatId: number };

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
    if (screen.name === 'chat') return <ChatScreen user={user} chatId={screen.chatId} peer={screen.peer} groupName={screen.groupName} groupId={screen.groupId}
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
      onOpenChat={() => push({ name: 'chat', chatId: screen.chatId, groupId: screen.groupId, groupName: '' })}
      onOpenProfile={(id) => push({ name: 'user_profile', userId: id })} />;
    const tab = (screen as { name: 'tabs'; tab: Tab }).tab;
    return (
      <TabsShell tab={tab} onTab={(t) => push({ name: 'tabs', tab: t })} user={user}>
        {tab === 'search' && <SearchTab user={user} onOpenProfile={(id) => push({ name: 'user_profile', userId: id })} />}
        {tab === 'chats' && <ChatsTab user={user}
          onOpenChat={(c) => push({ name: 'chat', chatId: c.chat_id, peer: c.peer_id ? { id: c.peer_id, nick: c.peer_nick!, avatar_url: c.peer_avatar } : undefined, groupName: c.group_name, groupId: c.group_id })}
          onNewGroup={() => push({ name: 'new_group' })}
          onOpenGroup={(gid, chatId) => push({ name: 'group_info', groupId: gid, chatId })} />}
        {tab === 'notifications' && <NotificationsTab user={user}
          onOpenChat={(chatId) => push({ name: 'chat', chatId })}
          onOpenProfile={(id) => push({ name: 'user_profile', userId: id })}
          onCall={(peerId, peerNick, peerAvatar, kind) => {
            const callId = `call_${Date.now()}`;
            setGlobalCall({ kind, callId, outgoing: true, peer: { id: peerId, nick: peerNick, avatar_url: peerAvatar } });
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

  const tabs: { key: Tab; icon: string; label: string; badge?: number }[] = [
    { key: 'search', icon: 'Search', label: 'Поиск' },
    { key: 'chats', icon: 'MessageCircle', label: 'Чаты', badge: unreadChats },
    { key: 'notifications', icon: 'Bell', label: 'Уведомления', badge: unreadNotifs },
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
function ChatsTab({ user, onOpenChat, onNewGroup, onOpenGroup }: { user: User; onOpenChat: (c: ChatItem) => void; onNewGroup: () => void; onOpenGroup: (gid: number, chatId: number) => void }) {
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
              <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-4"
                onClick={() => setDeleteConfirm(null)}>
                <div className="bg-white rounded-3xl p-5 w-full max-w-sm space-y-3 animate-fade-up shadow-xl"
                  onClick={e => e.stopPropagation()}>
                  <p className="font-bold text-center text-slate-800">Удалить чат?</p>
                  <p className="text-xs text-slate-500 text-center">Чат исчезнет только у тебя. Собеседник его не потеряет.</p>
                  <button onClick={() => hideChat(c.chat_id, false)}
                    className="w-full py-3 rounded-2xl bg-red-500 text-white text-sm font-bold">
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

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      const d = await api(`notifications&user_id=${user.id}`);
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

  return (
    <div className="flex flex-col h-full">
      <div className="shrink-0 px-4 pt-4 pb-3 bg-white border-b border-slate-100">
        <h1 className="text-2xl font-bold text-slate-900" style={{ letterSpacing: '-0.5px' }}>Уведомления</h1>
      </div>
      <div className="flex-1 overflow-y-auto scrollbar-thin px-3 pb-2">
        {loading && (
          <div className="flex justify-center mt-16">
            <div className="w-7 h-7 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
          </div>
        )}
        {!loading && notifs.length === 0 && (
          <div className="flex flex-col items-center justify-center mt-24 gap-3">
            <div className="w-16 h-16 rounded-2xl bg-blue-50 flex items-center justify-center">
              <Icon name="Bell" size={30} className="text-blue-300" />
            </div>
            <p className="font-semibold text-slate-500 text-sm">Нет уведомлений</p>
          </div>
        )}
        {notifs.map(n => (
          <div key={n.id}
            className={`flex items-start gap-3 px-3 py-3.5 rounded-2xl mb-1 transition-colors ${!n.is_read ? 'bg-blue-50 border border-blue-100' : 'bg-white border border-slate-100'}`}>
            {/* Аватар / иконка */}
            <div className={`w-11 h-11 rounded-2xl flex items-center justify-center shrink-0 overflow-hidden
              ${n.type === 'missed_call' ? 'bg-red-50' : n.type === 'follow' ? 'bg-green-50' : 'bg-blue-50'}`}>
              {n.from_avatar
                ? <img src={n.from_avatar} className="w-full h-full object-cover rounded-2xl" />
                : <Icon name={NOTIF_ICONS[n.type] || 'Bell'} size={20}
                    className={n.type === 'missed_call' ? 'text-red-500' : n.type === 'follow' ? 'text-green-500' : 'text-blue-500'} />
              }
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <span className={`text-xs font-semibold px-2 py-0.5 rounded-full
                  ${n.type === 'missed_call' ? 'bg-red-100 text-red-600' : n.type === 'follow' ? 'bg-green-100 text-green-600' : 'bg-blue-100 text-blue-600'}`}>
                  {NOTIF_LABELS[n.type] || n.type}
                </span>
              </div>
              {n.from_nick && <div className="text-sm font-semibold text-slate-700 mt-1">@{n.from_nick}</div>}
              <div className="text-xs text-slate-400 mt-0.5">{fmtTime(n.created_at)}</div>
              <div className="flex gap-2 mt-2 flex-wrap">
                {n.type === 'missed_call' && n.from_user_id && (
                  <>
                    <button onClick={() => onOpenProfile(n.from_user_id!)}
                      className="text-xs bg-slate-100 text-slate-600 rounded-xl px-3 py-1.5 font-medium flex items-center gap-1 active:bg-slate-200">
                      <Icon name="User" size={12} /> Профиль
                    </button>
                    <button onClick={() => onCall(n.from_user_id!, n.from_nick || '?', n.from_avatar, (n.payload === 'video' ? 'video' : 'audio'))}
                      className="text-xs bg-green-500 text-white rounded-xl px-3 py-1.5 font-semibold flex items-center gap-1 active:bg-green-600">
                      <Icon name="Phone" size={12} /> Перезвонить
                    </button>
                  </>
                )}
                {n.type === 'follow' && n.from_user_id && (
                  <button onClick={() => onOpenProfile(n.from_user_id!)}
                    className="text-xs bg-blue-600 text-white rounded-xl px-3 py-1.5 font-semibold flex items-center gap-1 active:bg-blue-700">
                    <Icon name="UserPlus" size={12} /> Посмотреть профиль
                  </button>
                )}
                {(n.type === 'new_message' || n.type === 'group_invite') && n.chat_id && (
                  <button onClick={() => onOpenChat(n.chat_id!)}
                    className="text-xs bg-blue-600 text-white rounded-xl px-3 py-1.5 font-semibold flex items-center gap-1 active:bg-blue-700">
                    <Icon name="MessageCircle" size={12} /> Открыть чат
                  </button>
                )}
              </div>
            </div>
            {!n.is_read && <span className="w-2 h-2 rounded-full bg-blue-500 shrink-0 mt-2" />}
          </div>
        ))}
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
      <header className="flex items-center gap-3 px-4 bg-blue-600 shadow-sm"
        style={{ paddingTop: 'calc(env(safe-area-inset-top) + 10px)', paddingBottom: '10px' }}>
        <button onClick={onBack} className="w-9 h-9 rounded-xl hover:bg-blue-500 flex items-center justify-center transition-colors">
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
    <div className="min-h-screen flex flex-col" style={{ background: '#f0f4fa' }}>
      <header className="flex items-center gap-3 px-4 py-3 bg-blue-600 shadow-sm">
        <button onClick={onBack} className="w-9 h-9 rounded-xl hover:bg-blue-500 flex items-center justify-center transition-colors">
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

  return (
    <div className="fixed inset-0 z-50 bg-black flex flex-col" style={{ touchAction: 'none' }}>
      <audio ref={remoteAudio} autoPlay playsInline style={{ position: 'absolute', width: 0, height: 0 }} />

      {kind === 'video' ? (
        <div className="relative flex-1 overflow-hidden bg-black">
          {/* Основное видео (большое) */}
          {selfBig ? (
            <video ref={localRef} autoPlay playsInline muted
              style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block', transform: localMirror }} />
          ) : (
            <video ref={remoteRef} autoPlay playsInline
              style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
          )}

          {/* Маленькое видео (в углу) — тап меняет местами */}
          <div onClick={() => setSelfBig(v => !v)}
            style={{ position: 'absolute', bottom: 16, right: 16, width: 110, height: 150,
              borderRadius: 16, overflow: 'hidden', border: '2px solid rgba(255,255,255,0.3)',
              zIndex: 10, cursor: 'pointer', boxShadow: '0 4px 16px rgba(0,0,0,0.5)' }}>
            {selfBig ? (
              <video ref={remoteRef} autoPlay playsInline
                style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
            ) : (
              <video ref={localRef} autoPlay playsInline muted
                style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block', transform: localMirror }} />
            )}
            <div style={{ position: 'absolute', bottom: 4, left: 0, right: 0, textAlign: 'center' }}>
              <span style={{ fontSize: 9, color: 'rgba(255,255,255,0.6)', background: 'rgba(0,0,0,0.4)',
                padding: '1px 6px', borderRadius: 99 }}>{selfBig ? 'собеседник' : 'я'}</span>
            </div>
          </div>

          {/* Кнопка переключения камеры */}
          <button onClick={flipCamera}
            style={{ position: 'absolute', top: 16, right: 16, zIndex: 15,
              width: 40, height: 40, borderRadius: '50%', background: 'rgba(255,255,255,0.2)',
              display: 'flex', alignItems: 'center', justifyContent: 'center', border: 'none' }}>
            <Icon name="RefreshCw" size={18} className="text-white" />
          </button>

          {status !== 'active' && (
            <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column',
              alignItems: 'center', justifyContent: 'center', background: 'rgba(0,0,0,0.75)', zIndex: 20 }}>
              <div className="relative mb-5">
                <span className="absolute inset-0 rounded-full bg-primary/40 animate-pulse-ring" />
                <Avatar url={peer.avatar_url} nick={peer.nick} size={96} />
              </div>
              <p className="text-white font-bold text-xl mb-1">@{peer.nick}</p>
              <p className="text-white/50 text-sm">{outgoing ? 'Вызов...' : 'Соединяемся...'}</p>
            </div>
          )}
          {status === 'active' && (
            <div style={{ position: 'absolute', top: 16, left: '50%', transform: 'translateX(-50%)',
              background: 'rgba(0,0,0,0.5)', borderRadius: 999, padding: '4px 16px', zIndex: 10 }}>
              <p className="text-white text-xs">{fmt(duration)}</p>
            </div>
          )}
        </div>
      ) : (
        <div className="flex-1 flex flex-col items-center justify-center" style={{ background: 'linear-gradient(160deg,#0d0d1a,#1a0d2e)' }}>
          <div className="relative mb-6">
            <span className="absolute inset-0 rounded-full bg-primary/30 animate-pulse-ring" />
            <Avatar url={peer.avatar_url} nick={peer.nick} size={112} />
          </div>
          <p className="text-white font-bold text-2xl mb-2">@{peer.nick}</p>
          <p className={`text-sm ${status === 'active' ? 'text-green-400' : 'text-white/50'}`}>
            {status === 'active' ? `● Соединено · ${fmt(duration)}` : outgoing ? 'Вызов...' : 'Соединяемся...'}
          </p>
        </div>
      )}

      {/* Панель кнопок */}
      <div className="flex items-center justify-center gap-5 shrink-0"
        style={{ padding: '24px 0 36px', background: 'rgba(0,0,0,0.88)' }}>

        {/* Микрофон */}
        <div className="flex flex-col items-center gap-1">
          <button onClick={toggleMic}
            style={{ width: 54, height: 54, borderRadius: '50%', display: 'flex', alignItems: 'center',
              justifyContent: 'center', background: micOn ? 'rgba(255,255,255,0.18)' : 'hsl(var(--destructive))' }}>
            <Icon name={micOn ? 'Mic' : 'MicOff'} size={22} className="text-white" />
          </button>
          <span style={{ fontSize: 10, color: 'rgba(255,255,255,0.45)' }}>{micOn ? 'Микрофон' : 'Без звука'}</span>
        </div>

        {/* Громкий/тихий — только для аудиозвонка */}
        {kind === 'audio' && (
          <div className="flex flex-col items-center gap-1">
            <button onClick={toggleSpeaker}
              style={{ width: 54, height: 54, borderRadius: '50%', display: 'flex', alignItems: 'center',
                justifyContent: 'center', background: speakerOn ? 'rgba(255,255,255,0.18)' : 'rgba(255,255,255,0.08)' }}>
              <Icon name={speakerOn ? 'Volume2' : 'VolumeX'} size={22} className="text-white" />
            </button>
            <span style={{ fontSize: 10, color: 'rgba(255,255,255,0.45)' }}>{speakerOn ? 'Громкий' : 'К уху'}</span>
          </div>
        )}

        {/* Камера вкл/выкл — только для видео */}
        {kind === 'video' && (
          <div className="flex flex-col items-center gap-1">
            <button onClick={toggleCam}
              style={{ width: 54, height: 54, borderRadius: '50%', display: 'flex', alignItems: 'center',
                justifyContent: 'center', background: camOn ? 'rgba(255,255,255,0.18)' : 'hsl(var(--destructive))' }}>
              <Icon name={camOn ? 'Video' : 'VideoOff'} size={22} className="text-white" />
            </button>
            <span style={{ fontSize: 10, color: 'rgba(255,255,255,0.45)' }}>{camOn ? 'Камера' : 'Без камеры'}</span>
          </div>
        )}

        {/* Завершить */}
        <div className="flex flex-col items-center gap-1">
          <button onClick={hangup}
            style={{ width: 62, height: 62, borderRadius: '50%', display: 'flex', alignItems: 'center',
              justifyContent: 'center', background: 'hsl(var(--destructive))', boxShadow: '0 4px 20px rgba(220,38,38,0.5)' }}>
            <Icon name="PhoneOff" size={26} className="text-white" />
          </button>
          <span style={{ fontSize: 10, color: 'rgba(255,255,255,0.45)' }}>Завершить</span>
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

function ChatScreen({ user, chatId, peer, groupName, groupId, onBack, onOpenProfile, onOpenGroup, autoCall, onCallStarted }: {
  user: User; chatId: number; peer?: User; groupName?: string; groupId?: number;
  onBack: () => void; onOpenProfile: (id: number) => void; onOpenGroup: (gid: number, chatId: number) => void;
  autoCall?: { kind: 'audio' | 'video' } | null;
  onCallStarted?: () => void;
}) {
  const [messages, setMessages] = useState<MsgExt[]>([]);
  const [input, setInput] = useState('');
  const [typing, setTyping] = useState<string[]>([]);
  const [peerOnline, setPeerOnline] = useState(false);
  const [selectedMsg, setSelectedMsg] = useState<number | null>(null);
  const [emojiTarget, setEmojiTarget] = useState<number | null>(null);
  const [showAttach, setShowAttach] = useState(false);
  const [recording, setRecording] = useState(false);
  const [recordSecs, setRecordSecs] = useState(0);
  const [inCall, setInCall] = useState<{ kind: 'audio' | 'video'; callId: string; outgoing: boolean } | null>(null);
  const [mediaView, setMediaView] = useState<{ src: string; type: 'image' | 'video' } | null>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState('');
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
    if (peer) setPeerOnline(d.peer_online || false);
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

  // При новых сообщениях — скроллим ТОЛЬКО если пользователь и так внизу
  useEffect(() => {
    if (!isAtBottomRef.current) return;
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
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
  };

  const uploadFile = async (file: File, type: 'image' | 'video' | 'audio' | 'voice') => {
    setUploading(true);
    setUploadProgress(type === 'video' ? 'Загрузка видео...' : type === 'image' ? 'Загрузка фото...' : 'Загрузка...');
    const reader = new FileReader();
    reader.onload = async () => {
      try {
        const [, b64] = (reader.result as string).split(',');
        const ext = file.name.split('.').pop() || (type === 'voice' ? 'ogg' : type === 'image' ? 'jpg' : type);
        const d = await api('upload_media', 'POST', { user_id: user.id, data: b64, ext, media_type: type });
        if (d.url) await send(undefined, d.url, type);
      } finally {
        setUploading(false);
        setUploadProgress('');
      }
    };
    reader.onerror = () => { setUploading(false); setUploadProgress(''); };
    reader.readAsDataURL(file);
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
  const subtitle = typing.length > 0 ? 'печатает...' : groupName ? 'Группа' : peerOnline ? 'в сети' : '';
  const subtitleColor = typing.length > 0 ? 'text-blue-200' : peerOnline && !groupName ? 'text-green-300' : 'text-blue-200';

  return (
    <div className="fixed inset-0 flex flex-col" style={{ background: '#f0f4fa' }} onClick={() => { setSelectedMsg(null); setEmojiTarget(null); setShowAttach(false); }}>
      {/* Header — фиксированный, как Telegram */}
      <header className="shrink-0 flex items-center gap-2 px-2 bg-blue-600 shadow-md"
        style={{ paddingTop: 'calc(env(safe-area-inset-top) + 8px)', paddingBottom: '10px' }}
        onClick={e => e.stopPropagation()}>
        <button onClick={onBack} className="w-10 h-10 rounded-full hover:bg-white/15 flex items-center justify-center transition-colors shrink-0">
          <Icon name="ArrowLeft" size={22} className="text-white" />
        </button>
        <button className="flex items-center gap-3 flex-1 text-left min-w-0"
          onClick={() => peer ? onOpenProfile(peer.id) : groupId && onOpenGroup(groupId, chatId)}>
          {peer ? <Avatar url={peer.avatar_url} nick={peer.nick} size={40} online={peerOnline} />
            : <div className="w-10 h-10 rounded-full bg-white/20 flex items-center justify-center shrink-0"><Icon name="Users" size={18} className="text-white" /></div>}
          <div className="min-w-0 flex-1">
            <div className="font-semibold text-white text-base truncate leading-tight">{title}</div>
            {subtitle && <div className={`text-xs truncate mt-0.5 ${subtitleColor}`}>{subtitle}</div>}
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

          return (
            <div key={m.id} className={`flex flex-col ${mine ? 'items-end' : 'items-start'} ${isLast ? (mine ? 'msg-out' : 'msg-in') : ''}`}
              onClick={e => { e.stopPropagation(); if (!m.is_removed) { setSelectedMsg(isSelected ? null : m.id); setEmojiTarget(null); } }}>
              {showNick && <span className="text-[11px] text-accent ml-10 mb-0.5">{m.sender_nick}</span>}
              <div className={`flex items-end gap-1.5 ${mine ? 'flex-row-reverse' : ''} max-w-[82%]`}>
                {!mine && groupName && <Avatar url={m.sender_avatar} nick={m.sender_nick} size={26} />}
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
                                  <span className="text-sm underline underline-offset-2 break-all">{m.text || 'Файл'}</span>
                                </a>
                              : <p className="leading-relaxed break-words text-sm">{m.text}</p>
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
      <header className="flex items-center gap-3 px-4 bg-blue-600 shadow-sm"
        style={{ paddingTop: 'calc(env(safe-area-inset-top) + 10px)', paddingBottom: '10px' }}>
        <button onClick={onBack} className="w-9 h-9 rounded-xl hover:bg-blue-500 flex items-center justify-center transition-colors">
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
  onBack: () => void; onOpenChat: () => void; onOpenProfile: (id: number) => void;
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
    const reader = new FileReader();
    reader.onload = async () => {
      const [header, b64] = (reader.result as string).split(',');
      const ext = header.includes('png') ? 'png' : 'jpg';
      await api('upload_group_photo', 'POST', { group_id: groupId, user_id: user.id, data: b64, ext });
      load();
    };
    reader.readAsDataURL(file);
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
      <header className="flex items-center gap-3 px-4 bg-blue-600 shadow-sm" onClick={e => e.stopPropagation()}
        style={{ paddingTop: 'calc(env(safe-area-inset-top) + 10px)', paddingBottom: '10px' }}>
        <button onClick={onBack} className="w-9 h-9 rounded-xl hover:bg-blue-500 flex items-center justify-center transition-colors">
          <Icon name="ArrowLeft" size={20} className="text-white" />
        </button>
        <span className="font-bold text-white flex-1">Группа</span>
        <button onClick={onOpenChat} className="px-4 py-2 rounded-xl bg-white text-blue-600 text-sm font-bold transition-all active:scale-95">
          <Icon name="MessageCircle" size={15} className="inline mr-1" />Чат
        </button>
      </header>

      <div className="flex-1 overflow-y-auto scrollbar-thin pb-8">

        {/* ── Шапка: фото + название + описание ── */}
        <div className="flex flex-col items-center pt-6 pb-2 px-4">
          <input ref={fileRef} type="file" accept="image/*" hidden onChange={uploadPhoto} />

          {/* Фото группы */}
          <div className="relative" onClick={e => { e.stopPropagation(); if (isAdmin) setShowPhotoMenu(v => !v); }}>
            <div className="w-24 h-24 rounded-full overflow-hidden cursor-pointer">
              {group.photo_url
                ? <img src={group.photo_url} className="w-full h-full object-cover" />
                : <div className="w-full h-full bg-blue-600 flex items-center justify-center">
                    <Icon name="Users" size={36} className="text-white" />
                  </div>}
            </div>
            {isAdmin && (
              <div className="absolute -bottom-1 -right-1 w-8 h-8 rounded-full bg-blue-600 flex items-center justify-center shadow-md cursor-pointer">
                <Icon name="Camera" size={14} className="text-white" />
              </div>
            )}
            {/* Меню фото */}
            {showPhotoMenu && (
              <div className="absolute top-full mt-2 left-1/2 -translate-x-1/2 bg-white rounded-2xl p-1 z-50 w-48 shadow-xl border border-slate-100" onClick={e => e.stopPropagation()}>
                <button onClick={() => { setShowPhotoMenu(false); fileRef.current?.click(); }}
                  className="w-full flex items-center gap-2 px-4 py-2.5 rounded-xl hover:bg-slate-50 text-sm text-slate-700">
                  <Icon name="Camera" size={15} className="text-blue-500" /> Изменить фото
                </button>
                {group.photo_url && (
                  <button onClick={removePhoto}
                    className="w-full flex items-center gap-2 px-4 py-2.5 rounded-xl hover:bg-destructive/10 text-sm text-destructive">
                    <Icon name="Trash2" size={15} /> Удалить фото
                  </button>
                )}
              </div>
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