import { useState, useRef, useEffect, useCallback } from 'react';
import Icon from '@/components/ui/icon';

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
    return r.json();
  } catch {
    return {};
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
type ChatItem = { chat_id: number; kind: 'dm' | 'group'; peer_id?: number; peer_nick?: string; peer_avatar?: string | null; peer_online?: boolean; group_id?: number; group_name?: string; group_avatar?: string | null; last_text?: string | null; last_at?: string | null };
type Message = { id: number; sender_id: number; sender_nick: string; sender_avatar?: string | null; text?: string | null; image_url?: string | null; media_type?: string | null; media_url?: string | null; created_at: string; is_removed?: boolean; reactions?: { emoji: string; user_id: number }[] };
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
  const [screen, setScreen] = useState<Screen>(user ? { name: 'tabs', tab: 'chats' } : { name: 'login' });
  const [draftNick, setDraftNick] = useState('');
  const [loginError, setLoginError] = useState('');
  const [lightTheme, setLightTheme] = useState(() => localStorage.getItem('orbit_theme') === 'light');

  useEffect(() => {
    if (lightTheme) {
      document.documentElement.style.setProperty('--background', '0 0% 97%');
      document.documentElement.style.setProperty('--foreground', '240 20% 10%');
      document.documentElement.style.setProperty('--card', '0 0% 100%');
      document.documentElement.style.setProperty('--card-foreground', '240 20% 10%');
      document.documentElement.style.setProperty('--secondary', '240 10% 90%');
      document.documentElement.style.setProperty('--secondary-foreground', '240 20% 10%');
      document.documentElement.style.setProperty('--muted', '240 10% 88%');
      document.documentElement.style.setProperty('--muted-foreground', '240 10% 40%');
      document.documentElement.style.setProperty('--border', '240 10% 82%');
      document.documentElement.style.setProperty('--input', '240 10% 82%');
      localStorage.setItem('orbit_theme', 'light');
    } else {
      document.documentElement.style.setProperty('--background', '240 30% 6%');
      document.documentElement.style.setProperty('--foreground', '240 20% 96%');
      document.documentElement.style.setProperty('--card', '240 25% 9%');
      document.documentElement.style.setProperty('--card-foreground', '240 20% 96%');
      document.documentElement.style.setProperty('--secondary', '240 20% 14%');
      document.documentElement.style.setProperty('--secondary-foreground', '240 20% 96%');
      document.documentElement.style.setProperty('--muted', '240 18% 16%');
      document.documentElement.style.setProperty('--muted-foreground', '240 12% 60%');
      document.documentElement.style.setProperty('--border', '240 18% 18%');
      document.documentElement.style.setProperty('--input', '240 18% 18%');
      localStorage.setItem('orbit_theme', 'dark');
    }
  }, [lightTheme]);

  const push = (s: Screen) => setScreen(s);
  const back = () => setScreen(user ? { name: 'tabs', tab: 'chats' } : { name: 'login' });

  // При открытии приложения — если нет user в localStorage но есть device_id → автовход
  useEffect(() => {
    if (user) return;
    const device_id = getDeviceId();
    // Пытаемся восстановить сессию по device (nick не нужен — передаём пустой, backend найдёт по device)
    api('login', 'POST', { nick: '__device_auto__', device_id }).then(data => {
      if (data.user) {
        const u = data.user;
        setUser(u);
        localStorage.setItem('orbit_user', JSON.stringify(u));
        push(u.profile_complete ? { name: 'tabs', tab: 'chats' } : { name: 'setup' });
      }
      // если ошибка — остаёмся на экране логина (новое устройство, нужно регистрироваться)
    });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const login = async () => {
    const nick = draftNick.trim().toLowerCase();
    if (nick.length < 2) return;
    setLoginError('');
    const data = await api('login', 'POST', { nick, device_id: getDeviceId() });
    if (data.error) { setLoginError(data.error as string); return; }
    if (!data.user) { setLoginError('Ошибка соединения, попробуй ещё раз'); return; }
    const u = data.user as User & { profile_complete: boolean };
    setUser(u);
    localStorage.setItem('orbit_user', JSON.stringify(u));
    push(u.profile_complete ? { name: 'tabs', tab: 'chats' } : { name: 'setup' });
  };

  const loginByNick = async (nick: string) => {
    setLoginError('');
    const data = await api('login_by_nick', 'POST', { nick: nick.trim().toLowerCase(), device_id: getDeviceId() });
    if (data.error) { setLoginError(data.error as string); return; }
    if (!data.user) { setLoginError('Ошибка соединения, попробуй ещё раз'); return; }
    const u = data.user as User & { profile_complete: boolean };
    setUser(u);
    localStorage.setItem('orbit_user', JSON.stringify(u));
    push(u.profile_complete ? { name: 'tabs', tab: 'chats' } : { name: 'setup' });
  };

  // Выход — НЕ удаляем device_id из localStorage, только user из памяти
  // При следующем открытии автовход сработает по device_id
  const logout = () => {
    if (user) api('offline', 'POST', { user_id: user.id });
    localStorage.removeItem('orbit_user');
    setUser(null);
    push({ name: 'login' });
  };

  // Удаление аккаунта — чистит device_id в БД → можно регистрироваться заново
  const deleteAccount = async () => {
    if (!user) return;
    await api('delete_account', 'POST', { user_id: user.id });
    localStorage.removeItem('orbit_user');
    setUser(null);
    push({ name: 'login' });
  };

  // ping online every 30s
  useEffect(() => {
    if (!user) return;
    const iv = setInterval(() => api('ping', 'POST', { user_id: user.id }), 30000);
    api('ping', 'POST', { user_id: user.id });
    const off = () => api('offline', 'POST', { user_id: user.id });
    window.addEventListener('beforeunload', off);
    return () => { clearInterval(iv); window.removeEventListener('beforeunload', off); };
  }, [user]);

  if (!user || screen.name === 'login') return <LoginScreen draftNick={draftNick} setDraftNick={setDraftNick} onLogin={login} onLoginByNick={loginByNick} error={loginError} setError={setLoginError} />;
  if (screen.name === 'setup') return <SetupScreen user={user} onDone={(u) => { setUser(u); localStorage.setItem('orbit_user', JSON.stringify(u)); push({ name: 'tabs', tab: 'chats' }); }} />;
  if (screen.name === 'chat') return <ChatScreen user={user} chatId={screen.chatId} peer={screen.peer} groupName={screen.groupName} groupId={screen.groupId}
    onBack={() => push({ name: 'tabs', tab: 'chats' })}
    onOpenProfile={(id) => push({ name: 'user_profile', userId: id })}
    onOpenGroup={(gid, chatId) => push({ name: 'group_info', groupId: gid, chatId })} />;
  if (screen.name === 'user_profile') return <UserProfileScreen me={user} userId={screen.userId} onBack={back}
    onOpenChat={async (peerId) => { const d = await api('open_chat', 'POST', { user_id: user.id, peer_id: peerId }); push({ name: 'chat', chatId: d.chat_id, peer: d.peer }); }}
    onFollowers={(uid, mode) => push({ name: 'followers', userId: uid, mode })} />;
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
        onOpenProfile={(id) => push({ name: 'user_profile', userId: id })} />}
      {tab === 'profile' && <ProfileTab user={user} onLogout={logout} onUpdate={(u) => { setUser(u); localStorage.setItem('orbit_user', JSON.stringify(u)); }} onFollowers={(uid, mode) => push({ name: 'followers', userId: uid, mode })} lightTheme={lightTheme} onToggleTheme={() => setLightTheme(v => !v)} onDeleteAccount={deleteAccount} />}
    </TabsShell>
  );
}

// ══════════════════════════════════════════════════════════════════════════════
// LOGIN
// ══════════════════════════════════════════════════════════════════════════════
function LoginScreen({ draftNick, setDraftNick, onLogin, onLoginByNick, error, setError }: {
  draftNick: string; setDraftNick: (v: string) => void;
  onLogin: () => void; onLoginByNick: (nick: string) => void;
  error: string; setError: (e: string) => void;
}) {
  const [tab, setTab] = useState<'login' | 'register'>('login');
  const [loginNick, setLoginNick] = useState('');
  const [nickStatus, setNickStatus] = useState<'idle' | 'checking' | 'ok' | 'taken'>('idle');
  const [nickHint, setNickHint] = useState('');

  useEffect(() => { setError(''); }, [tab]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (tab !== 'register') return;
    const q = draftNick.trim().toLowerCase();
    if (q.length < 2) { setNickStatus('idle'); setNickHint(''); return; }
    setNickStatus('checking');
    const t = setTimeout(async () => {
      const d = await api(`check_nick&nick=${encodeURIComponent(q)}&user_id=0`);
      if (d.available) { setNickStatus('ok'); setNickHint('Ник свободен!'); }
      else { setNickStatus('taken'); setNickHint(d.error || 'Ник занят'); }
    }, 500);
    return () => clearTimeout(t);
  }, [draftNick, tab]);

  const nickColor = nickStatus === 'ok' ? 'text-green-400' : nickStatus === 'taken' ? 'text-destructive' : 'text-muted-foreground';
  const borderColor = nickStatus === 'ok' ? 'border-green-400/60' : nickStatus === 'taken' ? 'border-destructive/60' : 'border-border';

  return (
    <div className="min-h-screen grad-mesh relative overflow-hidden flex items-center justify-center p-6">
      <div className="absolute top-1/4 -left-20 w-96 h-96 rounded-full bg-primary/30 blur-[120px] animate-float" />
      <div className="absolute bottom-1/4 -right-20 w-96 h-96 rounded-full bg-accent/20 blur-[120px] animate-float" style={{ animationDelay: '2s' }} />
      <div className="relative w-full max-w-md animate-fade-up">
        {/* Логотип */}
        <div className="flex flex-col items-center mb-8">
          <div className="relative mb-6 animate-sway" style={{ transformOrigin: 'center 30%' }}>
            {/* Мягкое свечение позади */}
            <div className="absolute -inset-4 rounded-[40px] bg-gradient-to-br from-primary/40 to-accent/30 blur-3xl" />
            {/* Основной блок */}
            <div className="relative w-28 h-28 rounded-[32px] shadow-2xl shadow-primary/40 overflow-hidden"
              style={{ background: 'linear-gradient(145deg, hsl(230 60% 22%), hsl(240 55% 16%))' }}>
              {/* Верхний блик */}
              <div className="absolute top-0 left-0 right-0 h-1/2 rounded-t-[32px]"
                style={{ background: 'linear-gradient(180deg, rgba(255,255,255,0.07) 0%, transparent 100%)' }} />
              {/* Фиолетовый акцент снизу */}
              <div className="absolute bottom-0 left-0 right-0 h-16 rounded-b-[32px]"
                style={{ background: 'linear-gradient(0deg, hsl(265 89% 40% / 0.5) 0%, transparent 100%)' }} />
              {/* Иконка — стилизованная "В" */}
              <div className="relative z-10 w-full h-full flex items-center justify-center">
                <svg width="62" height="56" viewBox="0 0 62 56" fill="none" xmlns="http://www.w3.org/2000/svg">
                  {/* Левый пузырь */}
                  <rect x="2" y="4" width="34" height="26" rx="9" fill="white" fillOpacity="0.92"/>
                  {/* Хвостик левого */}
                  <path d="M10 30 L4 42 L20 30 Z" fill="white" fillOpacity="0.92"/>
                  {/* Правый пузырь */}
                  <rect x="22" y="22" width="36" height="26" rx="9" fill="url(#grd)"/>
                  {/* Хвостик правого */}
                  <path d="M50 48 L58 58 L42 48 Z" fill="url(#grd)"/>
                  {/* Точки в левом */}
                  <circle cx="12" cy="17" r="2.5" fill="hsl(265 89% 66%)"/>
                  <circle cx="19" cy="17" r="2.5" fill="hsl(190 95% 55%)"/>
                  <circle cx="26" cy="17" r="2.5" fill="hsl(320 85% 65%)"/>
                  <defs>
                    <linearGradient id="grd" x1="22" y1="22" x2="58" y2="48" gradientUnits="userSpaceOnUse">
                      <stop stopColor="hsl(265, 89%, 66%)"/>
                      <stop offset="1" stopColor="hsl(190, 95%, 55%)"/>
                    </linearGradient>
                  </defs>
                </svg>
              </div>
            </div>
          </div>
          {/* Название под логотипом */}
          <p className="font-display font-black text-3xl tracking-tight text-center leading-tight select-none">
            <span className="text-gradient">Вай</span>
            <span className="text-foreground"> Мессенджер</span>
          </p>
          <p className="text-muted-foreground/70 text-xs mt-2 tracking-widest uppercase">Общайся свободно</p>
        </div>
        <div className="glass rounded-3xl p-8 shadow-2xl">
          {/* Вкладки */}
          <div className="flex bg-secondary/40 rounded-2xl p-1 mb-6">
            <button
              onClick={() => { setTab('login'); setLoginNick(''); }}
              className={`flex-1 py-2.5 rounded-xl font-semibold text-sm transition-all ${tab === 'login' ? 'bg-gradient-to-r from-primary to-accent text-white shadow' : 'text-muted-foreground'}`}
            >Войти</button>
            <button
              onClick={() => { setTab('register'); }}
              className={`flex-1 py-2.5 rounded-xl font-semibold text-sm transition-all ${tab === 'register' ? 'bg-gradient-to-r from-primary to-accent text-white shadow' : 'text-muted-foreground'}`}
            >Зарегистрироваться</button>
          </div>

          {tab === 'login' ? (
            <>
              <p className="text-muted-foreground text-sm mb-6">Введи свой ник чтобы войти в аккаунт</p>
              <div className="relative mb-1">
                <span className="absolute left-4 top-1/2 -translate-y-1/2 text-muted-foreground">@</span>
                <input
                  value={loginNick}
                  onChange={(e) => setLoginNick(e.target.value.replace(/[^a-zA-Z0-9_]/g, '').toLowerCase())}
                  onKeyDown={(e) => e.key === 'Enter' && loginNick.trim().length >= 2 && onLoginByNick(loginNick)}
                  placeholder="my_nickname"
                  maxLength={30}
                  autoFocus
                  className="w-full bg-secondary/60 border border-border rounded-2xl pl-9 pr-4 py-3.5 outline-none focus:ring-2 focus:ring-primary transition-all"
                />
              </div>
              <p className="text-xs mb-5 h-4 text-muted-foreground">Только латиница, цифры и _</p>
              {error && <p className="text-destructive text-sm mb-4">{error}</p>}
              <button
                disabled={loginNick.trim().length < 2}
                onClick={() => onLoginByNick(loginNick)}
                className="w-full py-4 rounded-2xl font-semibold bg-gradient-to-r from-primary to-accent hover:opacity-90 disabled:opacity-40 transition-all shadow-lg shadow-primary/30 text-white"
              >Войти →</button>
            </>
          ) : (
            <>
              <p className="text-muted-foreground text-sm mb-2">Придумай уникальный ник. Только латиница, цифры и _</p>
              <p className="text-xs text-muted-foreground mb-6">С этого устройства будешь входить автоматически</p>
              <div className="relative mb-1">
                <span className="absolute left-4 top-1/2 -translate-y-1/2 text-muted-foreground">@</span>
                <input
                  value={draftNick}
                  onChange={(e) => setDraftNick(e.target.value.replace(/[^a-zA-Z0-9_]/g, '').toLowerCase())}
                  onKeyDown={(e) => e.key === 'Enter' && nickStatus === 'ok' && onLogin()}
                  placeholder="my_nickname"
                  maxLength={30}
                  className={`w-full bg-secondary/60 border rounded-2xl pl-9 pr-10 py-3.5 outline-none focus:ring-2 focus:ring-primary transition-all ${borderColor}`}
                />
                <span className="absolute right-4 top-1/2 -translate-y-1/2">
                  {nickStatus === 'checking' && <span className="w-4 h-4 border-2 border-primary border-t-transparent rounded-full animate-spin block" />}
                  {nickStatus === 'ok' && <Icon name="Check" size={16} className="text-green-400" />}
                  {nickStatus === 'taken' && <Icon name="X" size={16} className="text-destructive" />}
                </span>
              </div>
              <p className={`text-xs mb-5 h-4 ${nickColor}`}>{nickHint}</p>
              {error && <p className="text-destructive text-sm mb-4">{error}</p>}
              <button
                disabled={draftNick.trim().length < 2 || nickStatus !== 'ok'}
                onClick={onLogin}
                className="w-full py-4 rounded-2xl font-semibold bg-gradient-to-r from-primary to-accent hover:opacity-90 disabled:opacity-40 transition-all shadow-lg shadow-primary/30 text-white"
              >Зарегистрироваться →</button>
            </>
          )}
        </div>
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

  return (
    <div className="min-h-screen grad-mesh flex flex-col items-center justify-center p-4 overflow-y-auto">
      <div className="w-full max-w-md animate-fade-up py-8">
        <div className="flex items-center justify-center gap-2 mb-6">
          <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-primary to-accent flex items-center justify-center">
            <span className="text-white font-display font-black text-sm">ВМ</span>
          </div>
          <span className="font-display font-bold text-xl">Вай Мессенджер</span>
        </div>
        <h1 className="font-display font-bold text-2xl mb-1 text-center">Заполни профиль</h1>
        <p className="text-muted-foreground text-sm text-center mb-6">Это видят все пользователи. Заполни чтобы продолжить.</p>
        <div className="glass rounded-3xl p-6 space-y-5">
          {/* Аватар */}
          <div className="flex flex-col items-center gap-2">
            <button onClick={() => fileRef.current?.click()} className="relative">
              {avatar
                ? <img src={avatar} className="w-24 h-24 rounded-full object-cover" />
                : <div className="w-24 h-24 rounded-full bg-secondary/60 border-2 border-dashed border-border flex items-center justify-center"><Icon name="Camera" size={28} className="text-muted-foreground" /></div>
              }
              <div className="absolute -bottom-1 -right-1 w-8 h-8 rounded-full bg-gradient-to-br from-primary to-accent flex items-center justify-center"><Icon name="Plus" size={14} className="text-white" /></div>
            </button>
            <input ref={fileRef} type="file" accept="image/*" hidden onChange={pickAvatar} />
            <span className="text-xs text-muted-foreground">Фото профиля (необязательно)</span>
          </div>

          {/* Ник — только читаем */}
          <div>
            <label className="text-xs text-muted-foreground mb-1 block">Ник</label>
            <div className="w-full bg-secondary/30 border border-border rounded-2xl px-4 py-3 text-muted-foreground text-sm">@{user.nick}</div>
          </div>

          <div>
            <label className="text-xs text-muted-foreground mb-1 block">Город <span className="text-destructive">*</span></label>
            <input value={city} onChange={(e) => setCity(e.target.value)} placeholder="Москва" className="w-full bg-secondary/60 border border-border rounded-2xl px-4 py-3 outline-none focus:ring-2 focus:ring-primary transition-all" />
          </div>
          <div>
            <label className="text-xs text-muted-foreground mb-1 block">Дата рождения <span className="text-destructive">*</span></label>
            <input type="date" value={birthdate} onChange={(e) => setBirthdate(e.target.value)} className="w-full bg-secondary/60 border border-border rounded-2xl px-4 py-3 outline-none focus:ring-2 focus:ring-primary transition-all" />
          </div>
          <div>
            <label className="text-xs text-muted-foreground mb-1 block">О себе</label>
            <textarea value={about} onChange={(e) => setAbout(e.target.value)} rows={3} placeholder="Расскажи о себе..." className="w-full bg-secondary/60 border border-border rounded-2xl px-4 py-3 outline-none focus:ring-2 focus:ring-primary transition-all resize-none" />
          </div>
          {!canSave && <p className="text-xs text-muted-foreground text-center">Заполни город и дату рождения чтобы продолжить</p>}
          <button onClick={save} disabled={saving || !canSave} className="w-full py-4 rounded-2xl font-semibold bg-gradient-to-r from-primary to-accent hover:opacity-90 disabled:opacity-40 transition-all shadow-lg shadow-primary/30 text-white">
            {saving ? 'Сохраняю...' : 'Готово →'}
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
  const [unread, setUnread] = useState(0);
  useEffect(() => {
    const load = () => api(`notifications&user_id=${user.id}`).then(d => {
      setUnread(Number(d.unread) || 0);
    });
    load();
    const iv = setInterval(load, 15000);
    return () => clearInterval(iv);
  }, [user.id]);

  const tabs: { key: Tab; icon: string; label: string; badge?: number }[] = [
    { key: 'search', icon: 'Search', label: 'Поиск' },
    { key: 'chats', icon: 'MessageCircle', label: 'Чаты' },
    { key: 'notifications', icon: 'Bell', label: 'Уведомления', badge: unread },
    { key: 'profile', icon: 'User', label: 'Профиль' },
  ];
  return (
    <div className="min-h-screen grad-mesh flex flex-col">
      <div className="flex-1 overflow-hidden flex flex-col pb-[68px]">{children}</div>
      <nav className="fixed bottom-0 left-0 right-0 glass border-t border-border flex safe-area-pb">
        {tabs.map(t => (
          <button key={t.key} onClick={() => onTab(t.key)}
            className={`flex-1 flex flex-col items-center justify-center py-2.5 gap-0.5 transition-colors relative ${tab === t.key ? 'text-primary' : 'text-muted-foreground hover:text-foreground'}`}>
            <div className="relative">
              <Icon name={t.icon} size={22} />
              {(t.badge || 0) > 0 && (
                <span className="absolute -top-1.5 -right-2 min-w-[16px] h-4 rounded-full bg-destructive text-white text-[9px] font-bold flex items-center justify-center px-1">
                  {t.badge! > 99 ? '99+' : t.badge}
                </span>
              )}
            </div>
            <span className="text-[10px] font-medium">{t.label}</span>
            {tab === t.key && <span className="absolute bottom-0 left-1/2 -translate-x-1/2 w-8 h-0.5 bg-primary rounded-full" />}
          </button>
        ))}
      </nav>
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

  const load = useCallback(async () => {
    const d = await api(`chats&user_id=${user.id}`);
    setChats(d.chats || []);
  }, [user.id]);

  useEffect(() => { load(); const iv = setInterval(load, 3000); return () => clearInterval(iv); }, [load]);

  const hideChat = async (chatId: number) => {
    await api('hide_chat', 'POST', { user_id: user.id, chat_id: chatId });
    setChats(cs => cs.filter(c => c.chat_id !== chatId));
    setSwipedId(null);
  };

  return (
    <div className="flex flex-col h-full" onClick={() => { setShowMenu(false); setSwipedId(null); }}>
      <header className="flex items-center justify-between px-4 py-4 glass" onClick={e => e.stopPropagation()}>
        <div className="flex items-center gap-2.5">
          <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-primary to-accent flex items-center justify-center shadow-lg shadow-primary/30">
            <span className="text-white font-display font-black text-sm leading-none">ВМ</span>
          </div>
          <span className="font-display font-bold text-xl tracking-tight">Вай Мессенджер</span>
        </div>
        <div className="relative">
          <button onClick={() => setShowMenu(v => !v)} className="w-10 h-10 rounded-full hover:bg-secondary/60 flex items-center justify-center transition-colors">
            <Icon name="Plus" size={22} />
          </button>
          {showMenu && (
            <div className="absolute right-0 top-12 glass rounded-2xl p-1 z-50 w-52 shadow-xl animate-fade-up">
              <button onClick={() => { setShowMenu(false); onNewGroup(); }} className="w-full flex items-center gap-3 px-4 py-3 rounded-xl hover:bg-secondary/60 transition-colors text-sm">
                <Icon name="Users" size={16} className="text-accent" /> Создать группу
              </button>
            </div>
          )}
        </div>
      </header>
      <div className="flex-1 overflow-y-auto scrollbar-thin p-2">
        {chats.length === 0 && (
          <div className="text-center text-muted-foreground mt-20">
            <Icon name="MessagesSquare" size={48} className="mx-auto mb-3 opacity-30" />
            <p className="font-medium">Нет чатов</p>
            <p className="text-sm mt-1">Найди людей через поиск</p>
          </div>
        )}
        {chats.map(c => (
          <div key={c.chat_id} className="relative overflow-hidden rounded-2xl mb-0.5">
            {/* Кнопка удаления — показывается при свайпе/нажатии */}
            {swipedId === c.chat_id && (
              <div className="absolute right-0 top-0 bottom-0 flex items-center pr-3 animate-slide-in-right">
                <button onClick={e => { e.stopPropagation(); hideChat(c.chat_id); }}
                  className="h-12 px-5 rounded-2xl bg-destructive text-white text-sm font-semibold flex items-center gap-1.5 shadow-lg">
                  <Icon name="Trash2" size={16} /> Удалить
                </button>
              </div>
            )}
            <button
              onClick={() => swipedId === c.chat_id ? setSwipedId(null) : onOpenChat(c)}
              onContextMenu={e => { e.preventDefault(); setSwipedId(c.chat_id); }}
              onTouchStart={() => {
                const t = setTimeout(() => setSwipedId(c.chat_id), 500);
                const up = () => { clearTimeout(t); window.removeEventListener('touchend', up); };
                window.addEventListener('touchend', up);
              }}
              className={`w-full flex items-center gap-3 px-3 py-3 rounded-2xl hover:bg-secondary/40 transition-all ${swipedId === c.chat_id ? 'translate-x-[-80px]' : 'translate-x-0'}`}>
              {c.kind === 'group'
                ? <div className="w-12 h-12 rounded-full shrink-0 overflow-hidden">
                    {c.group_avatar
                      ? <img src={c.group_avatar} className="w-full h-full object-cover" />
                      : <div className="w-full h-full bg-gradient-to-br from-primary/70 to-accent/70 flex items-center justify-center"><Icon name="Users" size={22} className="text-white" /></div>
                    }
                  </div>
                : <Avatar url={c.peer_avatar} nick={c.peer_nick || '?'} size={48} online={c.peer_online} />
              }
              <div className="flex-1 min-w-0 text-left">
                <div className="font-semibold truncate">{c.kind === 'group' ? c.group_name : `@${c.peer_nick}`}</div>
                <div className="text-sm text-muted-foreground truncate">{c.last_text || 'Нет сообщений'}</div>
              </div>
              <div className="flex flex-col items-end gap-1 shrink-0">
                <span className="text-[11px] text-muted-foreground">{fmtTime(c.last_at || null)}</span>
                {c.kind === 'group' && c.group_id && (
                  <button onClick={e => { e.stopPropagation(); onOpenGroup(c.group_id!, c.chat_id); }}
                    className="w-6 h-6 rounded-full hover:bg-secondary/80 flex items-center justify-center transition-colors">
                    <Icon name="Info" size={14} className="text-accent" />
                  </button>
                )}
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
      <header className="px-4 py-4 glass">
        <h2 className="font-display font-bold text-xl mb-3">Поиск людей</h2>
        <div className="relative">
          <Icon name="Search" size={18} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="Найти по нику…" className="w-full bg-secondary/60 border border-border rounded-full pl-10 pr-4 py-2.5 outline-none focus:ring-2 focus:ring-primary transition-all" />
        </div>
      </header>
      <div className="flex-1 overflow-y-auto scrollbar-thin p-2">
        {q.trim() && results.length === 0 && <p className="text-center text-muted-foreground mt-12 text-sm">Никого не найдено</p>}
        {results.map(u => (
          <button key={u.id} onClick={() => onOpenProfile(u.id)} className="w-full flex items-center gap-3 px-3 py-3 rounded-2xl hover:bg-secondary/40 transition-colors animate-fade-up">
            <Avatar url={u.avatar_url} nick={u.nick} size={48} online={u.is_online} />
            <div className="flex-1 text-left">
              <div className="font-semibold">@{u.nick}</div>
              {u.city && <div className="text-xs text-muted-foreground">{u.city}</div>}
            </div>
            <Icon name="ChevronRight" size={18} className="text-muted-foreground" />
          </button>
        ))}
      </div>
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════════════
// USER PROFILE SCREEN (чужой)
// ══════════════════════════════════════════════════════════════════════════════
function UserProfileScreen({ me, userId, onBack, onOpenChat, onFollowers }: { me: User; userId: number; onBack: () => void; onOpenChat: (id: number) => void; onFollowers: (uid: number, mode: 'followers' | 'following') => void }) {
  const [profile, setProfile] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(true);

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
    <div className="min-h-screen grad-mesh flex flex-col">
      <header className="flex items-center gap-3 px-4 py-3 glass">
        <button onClick={onBack} className="w-10 h-10 rounded-full hover:bg-secondary/60 flex items-center justify-center transition-colors"><Icon name="ArrowLeft" size={20} /></button>
        <span className="font-semibold flex-1">{profile ? `@${profile.nick}` : '...'}</span>
      </header>
      {loading && <div className="flex-1 flex items-center justify-center"><div className="w-8 h-8 border-2 border-primary border-t-transparent rounded-full animate-spin" /></div>}
      {profile && (
        <div className="flex-1 overflow-y-auto scrollbar-thin">
          <div className="flex flex-col items-center pt-8 pb-4 px-6">
            <Avatar url={profile.avatar_url} nick={profile.nick} size={96} online={profile.is_online} />
            <h2 className="font-display font-bold text-2xl mt-4">@{profile.nick}</h2>
            <p className="text-sm text-muted-foreground mt-1">
              {profile.is_online ? <span className="text-green-400">в сети</span> : fmtLastSeen(profile.last_seen || null)}
            </p>
            <div className="flex gap-8 mt-5">
              <button onClick={() => onFollowers(userId, 'followers')} className="flex flex-col items-center hover:text-primary transition-colors">
                <span className="font-display font-bold text-xl">{profile.followers}</span>
                <span className="text-xs text-muted-foreground">подписчиков</span>
              </button>
              <button onClick={() => onFollowers(userId, 'following')} className="flex flex-col items-center hover:text-primary transition-colors">
                <span className="font-display font-bold text-xl">{profile.following}</span>
                <span className="text-xs text-muted-foreground">подписок</span>
              </button>
            </div>
          </div>
          <div className="px-4 space-y-2 mb-4">
            {profile.city && <div className="flex items-center gap-2 text-sm"><Icon name="MapPin" size={16} className="text-accent" />{profile.city}</div>}
            {profile.birthdate && <div className="flex items-center gap-2 text-sm"><Icon name="Cake" size={16} className="text-accent" />{new Date(profile.birthdate).toLocaleDateString('ru-RU')}</div>}
            {profile.about && <p className="text-sm mt-3 leading-relaxed text-muted-foreground">{profile.about}</p>}
          </div>
          <div className="px-4 space-y-3 pb-8">
            {!profile.i_blocked ? (
              <>
                <button onClick={() => onOpenChat(userId)} className="w-full py-3.5 rounded-2xl font-semibold bg-gradient-to-r from-primary to-accent text-white hover:opacity-90 transition-all shadow-lg shadow-primary/30">
                  <Icon name="MessageCircle" size={18} className="inline mr-2" />Написать
                </button>
                {profile.i_follow
                  ? <button onClick={unfollow} className="w-full py-3.5 rounded-2xl font-semibold glass border border-border hover:bg-secondary/60 transition-colors"><Icon name="UserCheck" size={18} className="inline mr-2 text-green-400" />Отписаться</button>
                  : <button onClick={follow} className="w-full py-3.5 rounded-2xl font-semibold glass border border-border hover:bg-secondary/60 transition-colors"><Icon name="UserPlus" size={18} className="inline mr-2 text-accent" />Подписаться</button>
                }
                <button onClick={block} className="w-full py-3 rounded-2xl text-destructive text-sm hover:bg-destructive/10 transition-colors">
                  <Icon name="Ban" size={16} className="inline mr-2" />Заблокировать
                </button>
              </>
            ) : (
              <button onClick={unblock} className="w-full py-3.5 rounded-2xl font-semibold glass border border-border hover:bg-secondary/60 transition-colors text-destructive">
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
    <div className="min-h-screen grad-mesh flex flex-col">
      <header className="flex items-center gap-3 px-4 py-3 glass">
        <button onClick={onBack} className="w-10 h-10 rounded-full hover:bg-secondary/60 flex items-center justify-center"><Icon name="ArrowLeft" size={20} /></button>
        <span className="font-semibold">{mode === 'followers' ? 'Подписчики' : 'Подписки'}</span>
      </header>
      <div className="flex-1 overflow-y-auto scrollbar-thin p-2">
        {list.length === 0 && <p className="text-center text-muted-foreground mt-12 text-sm">Пусто</p>}
        {list.map(u => (
          <button key={u.id} onClick={() => onOpenProfile(u.id)} className="w-full flex items-center gap-3 px-3 py-3 rounded-2xl hover:bg-secondary/40 transition-colors">
            <Avatar url={u.avatar_url} nick={u.nick} size={44} online={u.is_online} />
            <span className="font-semibold flex-1 text-left">@{u.nick}</span>
            <Icon name="ChevronRight" size={18} className="text-muted-foreground" />
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
  lightTheme: boolean; onToggleTheme: () => void;
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

  const Toggle = ({ on, onToggle }: { on: boolean; onToggle: () => void }) => (
    <button onClick={onToggle} className={`relative w-12 h-6 rounded-full transition-colors ${on ? 'bg-primary' : 'bg-secondary'}`}>
      <span className={`absolute top-0.5 w-5 h-5 rounded-full bg-white shadow transition-transform ${on ? 'translate-x-6' : 'translate-x-0.5'}`} />
    </button>
  );

  return (
    <div className="flex flex-col h-full overflow-y-auto scrollbar-thin">
      <header className="px-4 py-4 glass flex items-center justify-between">
        <span className="font-display font-bold text-xl">Мой профиль</span>
      </header>

      {!profile && !loadError && (
        <div className="flex flex-col items-center justify-center flex-1 gap-3 mt-20">
          <div className="w-8 h-8 border-2 border-primary border-t-transparent rounded-full animate-spin" />
          <p className="text-sm text-muted-foreground">Загружаю профиль...</p>
        </div>
      )}
      {!profile && loadError && (
        <div className="flex flex-col items-center justify-center flex-1 gap-3 mt-20 px-6">
          <Icon name="WifiOff" size={40} className="text-muted-foreground opacity-50" />
          <p className="text-sm text-muted-foreground text-center">Не удалось загрузить профиль</p>
          <button onClick={load} className="px-5 py-2.5 rounded-2xl bg-gradient-to-r from-primary to-accent text-white text-sm font-semibold">
            Повторить
          </button>
        </div>
      )}
      {profile && (
        <div className="p-4 space-y-4 pb-8">
          {/* Аватар */}
          <div className="flex flex-col items-center pt-2 relative">
            <div className="relative cursor-pointer" onClick={() => setShowAvatarMenu(v => !v)}>
              <Avatar url={profile.avatar_url} nick={profile.nick} size={88} />
              <div className="absolute -bottom-1 -right-1 w-8 h-8 rounded-full bg-gradient-to-br from-primary to-accent flex items-center justify-center shadow">
                <Icon name="Camera" size={14} className="text-white" />
              </div>
            </div>
            <input ref={fileRef} type="file" accept="image/*" hidden onChange={pickAvatar} />
            {showAvatarMenu && (
              <div className="absolute top-24 glass rounded-2xl p-1 z-50 w-52 shadow-xl">
                <button onClick={() => { setShowAvatarMenu(false); fileRef.current?.click(); }} className="w-full flex items-center gap-3 px-4 py-3 rounded-xl hover:bg-secondary/60 transition-colors text-sm">
                  <Icon name="Camera" size={16} className="text-accent" /> Изменить фото
                </button>
                {profile.avatar_url && (
                  <button onClick={removeAvatar} className="w-full flex items-center gap-3 px-4 py-3 rounded-xl hover:bg-destructive/10 transition-colors text-sm text-destructive">
                    <Icon name="Trash2" size={16} /> Удалить фото
                  </button>
                )}
              </div>
            )}
            {/* Ник с редактированием */}
            {!editingNick ? (
              <button onClick={() => { setNewNick(profile.nick); setEditingNick(true); setNickStatus('idle'); setNickHint(''); }} className="flex items-center gap-2 mt-4 group">
                <h2 className="font-display font-bold text-2xl">@{profile.nick}</h2>
                <Icon name="Pencil" size={16} className="text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity" />
              </button>
            ) : (
              <div className="mt-4 w-full px-4">
                <div className="relative mb-1">
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground text-sm">@</span>
                  <input
                    autoFocus
                    value={newNick}
                    onChange={(e) => setNewNick(e.target.value.replace(/[^a-zA-Z0-9_]/g, '').toLowerCase())}
                    onKeyDown={(e) => { if (e.key === 'Enter') saveNick(); if (e.key === 'Escape') setEditingNick(false); }}
                    maxLength={30}
                    className="w-full bg-secondary/60 border border-border rounded-2xl pl-8 pr-10 py-2.5 outline-none focus:ring-2 focus:ring-primary transition-all text-center font-display font-bold text-lg"
                  />
                  <span className="absolute right-3 top-1/2 -translate-y-1/2">
                    {nickStatus === 'checking' && <span className="w-4 h-4 border-2 border-primary border-t-transparent rounded-full animate-spin block" />}
                    {nickStatus === 'ok' && <Icon name="Check" size={15} className="text-green-400" />}
                    {nickStatus === 'taken' && <Icon name="X" size={15} className="text-destructive" />}
                  </span>
                </div>
                <p className={`text-xs text-center mb-2 h-4 ${nickStatus === 'ok' ? 'text-green-400' : 'text-destructive'}`}>{nickHint}</p>
                <div className="flex gap-2">
                  <button onClick={saveNick} disabled={nickSaving || nickStatus !== 'ok'} className="flex-1 py-2 rounded-xl bg-gradient-to-r from-primary to-accent text-white text-sm font-semibold disabled:opacity-40">
                    {nickSaving ? '...' : 'Сохранить'}
                  </button>
                  <button onClick={() => setEditingNick(false)} className="flex-1 py-2 rounded-xl glass border border-border text-sm">Отмена</button>
                </div>
              </div>
            )}
            <div className="flex gap-8 mt-4">
              <button onClick={() => onFollowers(user.id, 'followers')} className="flex flex-col items-center hover:text-primary transition-colors">
                <span className="font-display font-bold text-xl">{profile.followers}</span>
                <span className="text-xs text-muted-foreground">подписчиков</span>
              </button>
              <button onClick={() => onFollowers(user.id, 'following')} className="flex flex-col items-center hover:text-primary transition-colors">
                <span className="font-display font-bold text-xl">{profile.following}</span>
                <span className="text-xs text-muted-foreground">подписок</span>
              </button>
            </div>
          </div>

          {/* Инфо / редактирование */}
          {!editing ? (
            <div className="glass rounded-3xl p-5 space-y-3">
              {profile.city && <div className="flex items-center gap-2 text-sm"><Icon name="MapPin" size={15} className="text-accent" />{profile.city}</div>}
              {profile.birthdate && <div className="flex items-center gap-2 text-sm"><Icon name="Cake" size={15} className="text-accent" />{new Date(profile.birthdate).toLocaleDateString('ru-RU')}</div>}
              {profile.about && <p className="text-sm text-muted-foreground leading-relaxed">{profile.about}</p>}
              {!profile.city && !profile.birthdate && !profile.about && <p className="text-sm text-muted-foreground">Профиль не заполнен</p>}
              <button onClick={() => setEditing(true)} className="w-full py-3 rounded-2xl font-medium glass border border-border hover:bg-secondary/60 transition-colors mt-2">
                <Icon name="Pencil" size={16} className="inline mr-2" />Редактировать
              </button>
            </div>
          ) : (
            <div className="glass rounded-3xl p-5 space-y-4">
              <div>
                <label className="text-xs text-muted-foreground mb-1 block">Город</label>
                <input value={city} onChange={(e) => setCity(e.target.value)} placeholder="Москва" className="w-full bg-secondary/60 border border-border rounded-2xl px-4 py-3 outline-none focus:ring-2 focus:ring-primary transition-all" />
              </div>
              <div>
                <label className="text-xs text-muted-foreground mb-1 block">Дата рождения</label>
                <input type="date" value={birthdate} onChange={(e) => setBirthdate(e.target.value)} className="w-full bg-secondary/60 border border-border rounded-2xl px-4 py-3 outline-none focus:ring-2 focus:ring-primary transition-all" />
              </div>
              <div>
                <label className="text-xs text-muted-foreground mb-1 block">О себе</label>
                <textarea value={about} onChange={(e) => setAbout(e.target.value)} rows={3} className="w-full bg-secondary/60 border border-border rounded-2xl px-4 py-3 outline-none focus:ring-2 focus:ring-primary transition-all resize-none" />
              </div>
              <div className="flex gap-2">
                <button onClick={save} disabled={saving} className="flex-1 py-3 rounded-2xl font-semibold bg-gradient-to-r from-primary to-accent text-white hover:opacity-90 disabled:opacity-50 transition-all">
                  {saving ? 'Сохраняю...' : 'Сохранить'}
                </button>
                <button onClick={() => setEditing(false)} className="flex-1 py-3 rounded-2xl glass border border-border hover:bg-secondary/60 transition-colors">Отмена</button>
              </div>
            </div>
          )}

          {/* Настройки */}
          <div className="glass rounded-3xl p-5 space-y-1">
            <p className="text-xs text-muted-foreground font-medium uppercase tracking-wider mb-3 px-1">Настройки</p>
            <div className="flex items-center justify-between py-2 px-1">
              <div className="flex items-center gap-3">
                <Icon name={lightTheme ? 'Sun' : 'Moon'} size={18} className="text-accent" />
                <span className="text-sm font-medium">{lightTheme ? 'Светлая тема' : 'Тёмная тема'}</span>
              </div>
              <Toggle on={lightTheme} onToggle={onToggleTheme} />
            </div>
          </div>

          {/* Аккаунт */}
          <div className="glass rounded-3xl p-5 space-y-1">
            <p className="text-xs text-muted-foreground font-medium uppercase tracking-wider mb-3 px-1">Аккаунт</p>
            <button onClick={onLogout} className="w-full flex items-center gap-3 py-3 px-1 rounded-2xl hover:bg-secondary/60 transition-colors">
              <Icon name="LogOut" size={18} className="text-muted-foreground" />
              <span className="text-sm font-medium">Выйти</span>
            </button>
            {!confirmDelete ? (
              <button onClick={() => setConfirmDelete(true)} className="w-full flex items-center gap-3 py-3 px-1 rounded-2xl hover:bg-destructive/10 transition-colors">
                <Icon name="Trash2" size={18} className="text-destructive" />
                <span className="text-sm font-medium text-destructive">Удалить аккаунт</span>
              </button>
            ) : (
              <div className="pt-2">
                <p className="text-sm text-destructive mb-3 px-1">Удалить аккаунт навсегда? Это нельзя отменить.</p>
                <div className="flex gap-2">
                  <button onClick={onDeleteAccount} className="flex-1 py-2.5 rounded-2xl bg-destructive text-white text-sm font-semibold">Удалить</button>
                  <button onClick={() => setConfirmDelete(false)} className="flex-1 py-2.5 rounded-2xl glass border border-border text-sm">Отмена</button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════════════
// CHAT SCREEN
// ══════════════════════════════════════════════════════════════════════════════
const EMOJIS = ['❤️','😂','😮','😢','👍','👎','🔥','🎉','😍','🤔'];

type Reaction = { emoji: string; user_id: number };
type MsgExt = Message & { reactions?: Reaction[]; is_removed?: boolean; media_type?: string; media_url?: string };

function ChatScreen({ user, chatId, peer, groupName, groupId, onBack, onOpenProfile, onOpenGroup }: {
  user: User; chatId: number; peer?: User; groupName?: string; groupId?: number;
  onBack: () => void; onOpenProfile: (id: number) => void; onOpenGroup: (gid: number, chatId: number) => void;
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
  const [inCall, setInCall] = useState<'audio' | 'video' | null>(null);
  const lastIdRef = useRef(0);
  const endRef = useRef<HTMLDivElement>(null);
  const typingTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mediaRec = useRef<MediaRecorder | null>(null);
  const audioChunks = useRef<Blob[]>([]);
  const fileRef = useRef<HTMLInputElement>(null);
  const fileRef2 = useRef<HTMLInputElement>(null);
  const fileType = useRef<'image' | 'video' | 'audio'>('image');
  const recordTimer = useRef<ReturnType<typeof setInterval> | null>(null);
  const cancelFlag = useRef(false);

  const poll = useCallback(async () => {
    const d = await api(`messages&chat_id=${chatId}&after=${lastIdRef.current}&user_id=${user.id}`);
    const fresh: MsgExt[] = d.messages || [];
    if (fresh.length) { lastIdRef.current = fresh[fresh.length - 1].id; setMessages(m => [...m, ...fresh]); }
    const s = await api(`chat_status&chat_id=${chatId}&user_id=${user.id}`);
    setTyping(s.typing || []);
    if (peer) {
      const pd = await api(`profile&user_id=${peer.id}&me=${user.id}`);
      setPeerOnline(pd.user?.is_online || false);
    }
  }, [chatId, user.id, peer]);

  useEffect(() => { poll(); const iv = setInterval(poll, 1500); return () => clearInterval(iv); }, [poll]);
  useEffect(() => { endRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [messages]);

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
    const reader = new FileReader();
    reader.onload = async () => {
      const [header, b64] = (reader.result as string).split(',');
      const ext = file.name.split('.').pop() || (type === 'voice' ? 'ogg' : type === 'image' ? 'jpg' : type);
      const d = await api('upload_media', 'POST', { user_id: user.id, data: b64, ext, media_type: type });
      if (d.url) await send(undefined, d.url, type);
    };
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
      setCancelVoiceFlag(false);
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
  const subtitleColor = typing.length > 0 ? 'text-primary' : peerOnline && !groupName ? 'text-green-400' : 'text-muted-foreground';

  return (
    <div className="min-h-screen grad-mesh flex flex-col" onClick={() => { setSelectedMsg(null); setEmojiTarget(null); setShowAttach(false); }}>
      {/* Header */}
      <header className="flex items-center gap-3 px-4 py-3 glass" onClick={e => e.stopPropagation()}>
        <button onClick={onBack} className="w-10 h-10 rounded-full hover:bg-secondary/60 flex items-center justify-center transition-colors">
          <Icon name="ArrowLeft" size={20} />
        </button>
        <button className="flex items-center gap-3 flex-1 text-left"
          onClick={() => peer ? onOpenProfile(peer.id) : groupId && onOpenGroup(groupId, chatId)}>
          {peer ? <Avatar url={peer.avatar_url} nick={peer.nick} size={38} online={peerOnline} />
            : <div className="w-10 h-10 rounded-full bg-gradient-to-br from-primary/70 to-accent/70 flex items-center justify-center shrink-0"><Icon name="Users" size={18} className="text-white" /></div>}
          <div>
            <div className="font-semibold text-sm">{title}</div>
            {subtitle && <div className={`text-xs ${subtitleColor}`}>{subtitle}</div>}
          </div>
        </button>
        <button onClick={() => setInCall('audio')} className="w-10 h-10 rounded-full hover:bg-secondary/60 flex items-center justify-center transition-colors">
          <Icon name="Phone" size={18} />
        </button>
        <button onClick={() => setInCall('video')} className="w-10 h-10 rounded-full bg-gradient-to-br from-primary to-accent flex items-center justify-center shadow-lg shadow-primary/30">
          <Icon name="Video" size={18} className="text-white" />
        </button>
      </header>

      {/* Messages */}
      <main className="flex-1 overflow-y-auto scrollbar-thin px-3 py-4 space-y-1">
        {messages.length === 0 && <p className="text-center text-muted-foreground text-sm mt-12">Напишите первое сообщение 👋</p>}
        {messages.map((m, i) => {
          const mine = m.sender_id === user.id;
          const showNick = !mine && !!groupName && (i === 0 || messages[i - 1].sender_id !== m.sender_id);
          const reactions: Reaction[] = m.reactions || [];
          const grouped = reactions.reduce<Record<string, number>>((acc, r) => { acc[r.emoji] = (acc[r.emoji] || 0) + 1; return acc; }, {});
          const isSelected = selectedMsg === m.id;
          const showEmoji = emojiTarget === m.id;

          return (
            <div key={m.id} className={`flex flex-col ${mine ? 'items-end' : 'items-start'}`}
              onClick={e => { e.stopPropagation(); if (!m.is_removed) { setSelectedMsg(isSelected ? null : m.id); setEmojiTarget(null); } }}>
              {showNick && <span className="text-[11px] text-accent ml-10 mb-0.5">{m.sender_nick}</span>}
              <div className={`flex items-end gap-1.5 ${mine ? 'flex-row-reverse' : ''} max-w-[82%]`}>
                {!mine && groupName && <Avatar url={m.sender_avatar} nick={m.sender_nick} size={26} />}
                <div className="relative">
                  <div className={`rounded-3xl px-4 py-2.5 ${mine ? 'bg-gradient-to-br from-primary to-accent text-white rounded-br-md' : 'bg-secondary/70 rounded-bl-md'} ${isSelected ? 'ring-2 ring-accent' : ''}`}>
                    {m.is_removed
                      ? <p className="text-xs italic opacity-60">Сообщение удалено</p>
                      : m.media_type === 'image' || m.image_url
                        ? <img src={m.media_url || m.image_url || ''} alt="" className="rounded-2xl max-h-60 max-w-full" />
                        : m.media_type === 'video'
                          ? <video src={m.media_url || ''} controls className="rounded-2xl max-h-48 max-w-full" />
                          : (m.media_type === 'audio' || m.media_type === 'voice')
                            ? <audio src={m.media_url || ''} controls className="max-w-[200px]" />
                            : m.media_type === 'file'
                              ? <a href={m.media_url || ''} target="_blank" rel="noopener noreferrer"
                                  className={`flex items-center gap-2 py-0.5 ${mine ? 'text-white' : 'text-foreground'}`}>
                                  <Icon name="FileText" size={20} className={mine ? 'text-white/80' : 'text-accent'} />
                                  <span className="text-sm underline underline-offset-2 break-all">{m.text || 'Файл'}</span>
                                </a>
                              : <p className="leading-relaxed break-words text-sm">{m.text}</p>
                    }
                    <span className={`block text-[10px] mt-0.5 ${mine ? 'text-white/60' : 'text-muted-foreground'}`}>{fmtTime(m.created_at)}</span>
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
        <div ref={endRef} />
      </main>

      {/* Composer */}
      <div className="p-3 glass" onClick={e => e.stopPropagation()}>
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

        {/* Attach menu */}
        {showAttach && !recording && (
          <div className="flex gap-2 mb-3 animate-fade-up">
            {[
              { icon: 'Image', label: 'Фото', type: 'image' as const },
              { icon: 'Video', label: 'Видео', type: 'video' as const },
              { icon: 'Music', label: 'Аудио', type: 'audio' as const },
            ].map(a => (
              <button key={a.type} onClick={() => pickFile(a.type)}
                className="flex-1 glass rounded-2xl py-3 flex flex-col items-center gap-1 hover:bg-secondary/60 transition-colors">
                <Icon name={a.icon} size={20} className="text-accent" />
                <span className="text-[10px] text-muted-foreground">{a.label}</span>
              </button>
            ))}
            <button onClick={() => { setShowAttach(false); fileRef2.current?.click(); }}
              className="flex-1 glass rounded-2xl py-3 flex flex-col items-center gap-1 hover:bg-secondary/60 transition-colors">
              <Icon name="FileText" size={20} className="text-accent" />
              <span className="text-[10px] text-muted-foreground">Файл</span>
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
            <button onPointerUp={stopVoice}
              className="w-10 h-10 shrink-0 rounded-full bg-destructive flex items-center justify-center shadow-lg shadow-destructive/40 animate-pulse">
              <Icon name="Send" size={18} className="text-white" />
            </button>
          </div>
        ) : (
          <div className="flex items-center gap-2">
            <button onClick={() => setShowAttach(v => !v)}
              className={`w-10 h-10 shrink-0 rounded-full flex items-center justify-center transition-colors ${showAttach ? 'bg-primary/30 text-primary' : 'hover:bg-secondary/60'}`}>
              <Icon name="Paperclip" size={20} />
            </button>
            <input value={input} onChange={e => handleInput(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && !e.shiftKey && send()}
              placeholder="Сообщение…"
              className="flex-1 bg-secondary/60 border border-border rounded-full px-4 py-2.5 outline-none focus:ring-2 focus:ring-primary transition-all text-sm" />
            {input.trim()
              ? <button onClick={() => send()} className="w-10 h-10 shrink-0 rounded-full bg-gradient-to-br from-primary to-accent hover:opacity-90 flex items-center justify-center shadow-lg shadow-primary/30">
                  <Icon name="Send" size={18} className="text-white" />
                </button>
              : <button onPointerDown={startVoice}
                  className="w-10 h-10 shrink-0 rounded-full bg-gradient-to-br from-primary to-accent flex items-center justify-center shadow-lg shadow-primary/30">
                  <Icon name="Mic" size={18} className="text-white" />
                </button>
            }
          </div>
        )}
      </div>

      {/* Звонок overlay */}
      {inCall && (
        <div className="fixed inset-0 z-50 bg-background/95 backdrop-blur-xl flex flex-col items-center justify-center p-6 animate-fade-up">
          <div className="relative mb-8">
            <span className="absolute inset-0 rounded-full bg-primary/40 animate-pulse-ring" />
            <Avatar url={peer?.avatar_url} nick={peer?.nick || '?'} size={120} />
          </div>
          <h2 className="font-display font-bold text-2xl mb-1">{title}</h2>
          <p className="text-muted-foreground mb-12">
            {inCall === 'video' ? 'Видеозвонок...' : 'Аудиозвонок...'}
          </p>
          <div className="flex items-center gap-5">
            <button className="w-14 h-14 rounded-full bg-secondary/70 flex items-center justify-center">
              <Icon name="Mic" size={22} />
            </button>
            {inCall === 'video' && (
              <button className="w-14 h-14 rounded-full bg-secondary/70 flex items-center justify-center">
                <Icon name="Video" size={22} />
              </button>
            )}
            <button onClick={() => {
              // Фиксируем пропущенный звонок у собеседника
              if (peer) api('notify_call', 'POST', { from_user_id: user.id, to_user_id: peer.id, call_type: inCall, chat_id: chatId });
              setInCall(null);
            }} className="w-16 h-16 rounded-full bg-destructive flex items-center justify-center shadow-lg shadow-destructive/40">
              <Icon name="PhoneOff" size={26} className="text-white" />
            </button>
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
    <div className="min-h-screen grad-mesh flex flex-col">
      <header className="flex items-center gap-3 px-4 py-3 glass">
        <button onClick={onBack} className="w-10 h-10 rounded-full hover:bg-secondary/60 flex items-center justify-center"><Icon name="ArrowLeft" size={20} /></button>
        <span className="font-semibold flex-1">Новая группа</span>
        <button onClick={create} disabled={!name.trim() || creating || selected.length === 0}
          className="px-5 py-2 rounded-full bg-gradient-to-r from-primary to-accent text-white text-sm font-semibold disabled:opacity-40">
          {creating ? '...' : 'Создать'}
        </button>
      </header>
      <div className="flex-1 overflow-y-auto scrollbar-thin p-4 space-y-4">
        <div>
          <label className="text-xs text-muted-foreground mb-1 block">Название группы</label>
          <input value={name} onChange={e => setName(e.target.value)} placeholder="Моя группа"
            className="w-full bg-secondary/60 border border-border rounded-2xl px-4 py-3 outline-none focus:ring-2 focus:ring-primary transition-all" />
        </div>

        {selected.length > 0 && (
          <div className="flex gap-2 flex-wrap">
            {selected.map(u => (
              <div key={u.id} className="flex items-center gap-1.5 bg-primary/20 rounded-full pl-2 pr-3 py-1">
                <Avatar url={u.avatar_url} nick={u.nick} size={20} />
                <span className="text-xs font-medium">@{u.nick}</span>
                <button onClick={() => toggle(u)}><Icon name="X" size={12} className="text-muted-foreground" /></button>
              </div>
            ))}
          </div>
        )}

        <div>
          <p className="text-xs text-muted-foreground mb-2 font-medium">Твои подписки ({followers.length})</p>
          {followers.length === 0 && <p className="text-sm text-muted-foreground text-center py-4">Пока нет подписок. Найди людей через поиск.</p>}
          {followers.length > 3 && (
            <div className="relative mb-3">
              <Icon name="Search" size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
              <input value={q} onChange={e => setQ(e.target.value)} placeholder="Фильтр…"
                className="w-full bg-secondary/60 border border-border rounded-full pl-9 pr-4 py-2 outline-none focus:ring-2 focus:ring-primary transition-all text-sm" />
            </div>
          )}
          {filtered.map(u => (
            <button key={u.id} onClick={() => toggle(u)} className="w-full flex items-center gap-3 px-3 py-2.5 rounded-2xl hover:bg-secondary/40 transition-colors">
              <Avatar url={u.avatar_url} nick={u.nick} size={40} online={u.is_online} />
              <span className="flex-1 text-left font-medium">@{u.nick}</span>
              <div className={`w-6 h-6 rounded-full border-2 flex items-center justify-center transition-colors ${selected.find(x => x.id === u.id) ? 'bg-primary border-primary' : 'border-border'}`}>
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

function NotificationsTab({ user, onOpenChat, onOpenProfile }: {
  user: User; onOpenChat: (chatId: number) => void; onOpenProfile: (id: number) => void;
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
    // таймаут защита — если fetch завис, всё равно убираем спиннер
    const t = setTimeout(() => { if (!cancelled) setLoading(false); }, 5000);
    return () => { cancelled = true; clearTimeout(t); };
  }, [user.id]);

  return (
    <div className="flex flex-col h-full">
      <header className="px-4 py-4 glass">
        <h2 className="font-display font-bold text-xl">Уведомления</h2>
      </header>
      <div className="flex-1 overflow-y-auto scrollbar-thin p-3">
        {loading && <div className="flex justify-center mt-12"><div className="w-8 h-8 border-2 border-primary border-t-transparent rounded-full animate-spin" /></div>}
        {!loading && notifs.length === 0 && (
          <div className="text-center text-muted-foreground mt-20">
            <Icon name="BellOff" size={48} className="mx-auto mb-3 opacity-30" />
            <p>Нет уведомлений</p>
          </div>
        )}
        {notifs.map(n => (
          <div key={n.id} className={`flex items-start gap-3 px-3 py-3.5 rounded-2xl mb-1 ${!n.is_read ? 'bg-primary/10' : 'hover:bg-secondary/40'} transition-colors`}>
            <div className={`w-11 h-11 rounded-full flex items-center justify-center shrink-0 overflow-hidden ${n.type === 'missed_call' ? 'bg-destructive/20' : 'bg-accent/20'}`}>
              {n.from_avatar
                ? <img src={n.from_avatar} className="w-full h-full object-cover" />
                : <Icon name={NOTIF_ICONS[n.type] || 'Bell'} size={20} className={n.type === 'missed_call' ? 'text-destructive' : 'text-accent'} />}
            </div>
            <div className="flex-1 min-w-0">
              <div className="text-sm font-semibold">{NOTIF_LABELS[n.type] || n.type}</div>
              {n.from_nick && <div className="text-sm text-muted-foreground">@{n.from_nick}</div>}
              <div className="text-xs text-muted-foreground mt-0.5">{fmtTime(n.created_at)}</div>
              <div className="flex gap-2 mt-2 flex-wrap">
                {n.type === 'missed_call' && n.from_user_id && (
                  <>
                    <button onClick={() => onOpenProfile(n.from_user_id!)}
                      className="text-xs glass rounded-full px-3 py-1.5 hover:bg-secondary/80 flex items-center gap-1">
                      <Icon name="User" size={12} /> Профиль
                    </button>
                    {n.chat_id && (
                      <button onClick={() => onOpenChat(n.chat_id!)}
                        className="text-xs bg-primary/20 text-primary rounded-full px-3 py-1.5 hover:bg-primary/30 flex items-center gap-1">
                        <Icon name="Phone" size={12} /> Перезвонить
                      </button>
                    )}
                  </>
                )}
                {n.type === 'follow' && n.from_user_id && (
                  <button onClick={() => onOpenProfile(n.from_user_id!)}
                    className="text-xs bg-accent/20 text-accent rounded-full px-3 py-1.5 hover:bg-accent/30 flex items-center gap-1">
                    <Icon name="UserPlus" size={12} /> Посмотреть профиль
                  </button>
                )}
                {(n.type === 'new_message' || n.type === 'group_invite') && n.chat_id && (
                  <button onClick={() => onOpenChat(n.chat_id!)}
                    className="text-xs bg-primary/20 text-primary rounded-full px-3 py-1.5 hover:bg-primary/30 flex items-center gap-1">
                    <Icon name="MessageCircle" size={12} /> Открыть чат
                  </button>
                )}
              </div>
            </div>
            {!n.is_read && <span className="w-2 h-2 rounded-full bg-primary shrink-0 mt-2" />}
          </div>
        ))}
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
    <div className="min-h-screen grad-mesh flex items-center justify-center">
      <div className="w-8 h-8 border-2 border-primary border-t-transparent rounded-full animate-spin" />
    </div>
  );

  const isPublic = group.is_public !== false;

  return (
    <div className="min-h-screen grad-mesh flex flex-col" onClick={() => { setShowPhotoMenu(false); setShowInvite(false); }}>
      <header className="flex items-center gap-3 px-4 py-3 glass" onClick={e => e.stopPropagation()}>
        <button onClick={onBack} className="w-10 h-10 rounded-full hover:bg-secondary/60 flex items-center justify-center">
          <Icon name="ArrowLeft" size={20} />
        </button>
        <span className="font-semibold flex-1">Группа</span>
        <button onClick={onOpenChat} className="px-4 py-2 rounded-full bg-gradient-to-r from-primary to-accent text-white text-sm font-semibold">
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
                : <div className="w-full h-full bg-gradient-to-br from-primary/70 to-accent/70 flex items-center justify-center">
                    <Icon name="Users" size={36} className="text-white" />
                  </div>}
            </div>
            {isAdmin && (
              <div className="absolute -bottom-1 -right-1 w-8 h-8 rounded-full bg-gradient-to-br from-primary to-accent flex items-center justify-center shadow cursor-pointer">
                <Icon name="Camera" size={14} className="text-white" />
              </div>
            )}
            {/* Меню фото */}
            {showPhotoMenu && (
              <div className="absolute top-full mt-2 left-1/2 -translate-x-1/2 glass rounded-2xl p-1 z-50 w-48 shadow-xl" onClick={e => e.stopPropagation()}>
                <button onClick={() => { setShowPhotoMenu(false); fileRef.current?.click(); }}
                  className="w-full flex items-center gap-2 px-4 py-2.5 rounded-xl hover:bg-secondary/60 text-sm">
                  <Icon name="Camera" size={15} className="text-accent" /> Изменить фото
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
              className="font-display font-bold text-2xl mt-4 text-center bg-transparent outline-none border-b border-transparent focus:border-primary/50 transition-colors px-2 w-full max-w-xs"
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
              className="text-sm text-muted-foreground mt-2 text-center bg-transparent outline-none border-b border-transparent focus:border-primary/50 transition-colors resize-none w-full max-w-xs placeholder:text-muted-foreground/40"
            />
          ) : (
            group.about && <p className="text-sm text-muted-foreground mt-2 text-center">{group.about}</p>
          )}

          <p className="text-xs text-muted-foreground mt-2">
            {isPublic ? '🌐 Публичная' : '🔒 Закрытая'} · {group.member_count} участников
          </p>
          {saving && <p className="text-xs text-primary mt-1">Сохраняю...</p>}
        </div>

        {/* ── Настройки (только для админа) ── */}
        {isAdmin && (
          <div className="mx-4 mb-3 glass rounded-2xl overflow-hidden">
            {/* Публичная/закрытая */}
            <div className="flex items-center justify-between px-4 py-3.5 border-b border-border/40">
              <div>
                <p className="text-sm font-medium">{isPublic ? 'Публичная группа' : 'Закрытая группа'}</p>
                <p className="text-xs text-muted-foreground">{isPublic ? 'Любой может вступить по ссылке' : 'Только по приглашению'}</p>
              </div>
              <button
                onClick={() => saveField({ is_public: !isPublic })}
                className={`relative w-12 h-6 rounded-full transition-colors ${isPublic ? 'bg-primary' : 'bg-secondary'}`}>
                <span className={`absolute top-0.5 w-5 h-5 rounded-full bg-white shadow transition-transform ${isPublic ? 'translate-x-6' : 'translate-x-0.5'}`} />
              </button>
            </div>
            {/* Ссылка */}
            <div className="px-4 py-3.5">
              <p className="text-xs text-muted-foreground mb-2">Ссылка-приглашение</p>
              <button onClick={copyLink} className="w-full py-2.5 rounded-xl bg-gradient-to-r from-primary to-accent text-white text-sm font-semibold">
                <Icon name={copied ? 'Check' : 'Link'} size={14} className="inline mr-1.5" />
                {copied ? 'Скопировано!' : 'Скопировать ссылку'}
              </button>
            </div>
          </div>
        )}

        {/* Ссылка для не-админа */}
        {!isAdmin && (
          <div className="mx-4 mb-3">
            <button onClick={copyLink} className="w-full py-2.5 rounded-2xl glass border border-border text-sm flex items-center justify-center gap-2">
              <Icon name={copied ? 'Check' : 'Link'} size={14} className="text-accent" />
              {copied ? 'Скопировано!' : 'Скопировать ссылку'}
            </button>
          </div>
        )}

        {/* ── Участники ── */}
        <div className="mx-4 mb-3">
          <div className="flex items-center justify-between mb-2 px-1">
            <p className="text-xs text-muted-foreground font-medium uppercase tracking-wider">Участники · {group.member_count}</p>
            {isAdmin && invitable.length > 0 && (
              <button onClick={e => { e.stopPropagation(); setShowInvite(v => !v); }}
                className="flex items-center gap-1 text-xs text-primary hover:opacity-80 transition-opacity">
                <Icon name="UserPlus" size={14} /> Пригласить
              </button>
            )}
          </div>

          {/* Панель приглашения */}
          {showInvite && (
            <div className="glass rounded-2xl p-3 mb-3" onClick={e => e.stopPropagation()}>
              <p className="text-xs text-muted-foreground mb-2">Выбери из подписок:</p>
              {invitable.length > 4 && (
                <input value={inviteQ} onChange={e => setInviteQ(e.target.value)} placeholder="Поиск..."
                  className="w-full bg-secondary/60 border border-border rounded-xl px-3 py-2 text-sm outline-none mb-2" />
              )}
              <div className="max-h-48 overflow-y-auto space-y-1">
                {filteredInvitable.map(u => (
                  <button key={u.id} onClick={() => addMember(u.id)}
                    className="w-full flex items-center gap-3 px-3 py-2 rounded-xl hover:bg-secondary/60 transition-colors">
                    <Avatar url={u.avatar_url} nick={u.nick} size={32} online={u.is_online} />
                    <span className="flex-1 text-left text-sm font-medium">@{u.nick}</span>
                    <Icon name="Plus" size={16} className="text-primary shrink-0" />
                  </button>
                ))}
                {filteredInvitable.length === 0 && (
                  <p className="text-xs text-muted-foreground text-center py-3">Все подписки уже в группе</p>
                )}
              </div>
            </div>
          )}

          <div className="glass rounded-3xl overflow-hidden">
            {members.map((m, i) => (
              <div key={m.id} className={`flex items-center gap-3 px-4 py-3 ${i < members.length - 1 ? 'border-b border-border/40' : ''}`}>
                <button onClick={() => m.id !== user.id && onOpenProfile(m.id)} className="flex items-center gap-3 flex-1 min-w-0 text-left">
                  <Avatar url={m.avatar_url} nick={m.nick} size={40} online={m.is_online} />
                  <div className="flex-1 min-w-0">
                    <div className="font-medium text-sm truncate">@{m.nick}{m.id === user.id ? ' (вы)' : ''}</div>
                    <div className="text-xs text-muted-foreground">{roleLabel[m.role] || 'Участник'}</div>
                  </div>
                </button>
                {isAdmin && m.id !== user.id && (
                  <div className="flex gap-1 shrink-0">
                    {isOwner && m.role === 'member' && (
                      <button onClick={() => setRole(m.id, 'admin')} title="Назначить админом"
                        className="w-8 h-8 rounded-full hover:bg-accent/20 flex items-center justify-center transition-colors">
                        <Icon name="Star" size={14} className="text-accent" />
                      </button>
                    )}
                    {isOwner && m.role === 'admin' && (
                      <button onClick={() => setRole(m.id, 'member')} title="Снять права"
                        className="w-8 h-8 rounded-full hover:bg-secondary/60 flex items-center justify-center transition-colors">
                        <Icon name="StarOff" size={14} className="text-muted-foreground" />
                      </button>
                    )}
                    {isOwner && (
                      <button onClick={() => setTransferTarget(m.id)} title="Передать владение"
                        className="w-8 h-8 rounded-full hover:bg-primary/20 flex items-center justify-center transition-colors">
                        <Icon name="Crown" size={14} className="text-primary" />
                      </button>
                    )}
                    <button onClick={() => setKickTarget(m.id)} title="Удалить из группы"
                      className="w-8 h-8 rounded-full hover:bg-destructive/20 flex items-center justify-center transition-colors">
                      <Icon name="UserX" size={14} className="text-destructive" />
                    </button>
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>

        {/* Подтверждение удаления */}
        {kickTarget && (
          <div className="mx-4 mb-3 glass rounded-2xl p-4">
            <p className="text-sm mb-3">Удалить @{members.find(m => m.id === kickTarget)?.nick} из группы?</p>
            <div className="flex gap-2">
              <button onClick={() => kick(kickTarget)}
                className="flex-1 py-2.5 rounded-2xl bg-destructive text-white text-sm font-semibold">Удалить</button>
              <button onClick={() => setKickTarget(null)}
                className="flex-1 py-2.5 rounded-2xl glass border border-border text-sm">Отмена</button>
            </div>
          </div>
        )}

        {/* Передача владения */}
        {transferTarget && (
          <div className="mx-4 mb-3 glass rounded-2xl p-4">
            <p className="text-sm mb-3">Передать владение @{members.find(m => m.id === transferTarget)?.nick}? Вы станете обычным участником.</p>
            <div className="flex gap-2">
              <button onClick={transfer}
                className="flex-1 py-2.5 rounded-2xl bg-gradient-to-r from-primary to-accent text-white text-sm font-semibold">Передать</button>
              <button onClick={() => setTransferTarget(null)}
                className="flex-1 py-2.5 rounded-2xl glass border border-border text-sm">Отмена</button>
            </div>
          </div>
        )}

        {/* Покинуть группу */}
        <div className="mx-4">
          <button onClick={leave}
            className="w-full py-3.5 rounded-2xl text-destructive hover:bg-destructive/10 transition-colors text-sm font-medium flex items-center justify-center gap-2">
            <Icon name="LogOut" size={16} />Покинуть группу
          </button>
        </div>
      </div>
    </div>
  );
}