import { useState, useEffect, useRef } from 'react';
import Icon from '@/components/ui/icon';

const API = 'https://functions.poehali.dev/382a3d36-c0ee-40d1-b3b4-0de44f786385';

const api = async (action: string, method = 'GET', body?: object, token?: string) => {
  try {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (token) headers['X-Admin-Token'] = token;
    const r = await fetch(`${API}?action=${action}`, {
      method, headers,
      body: body ? JSON.stringify(body) : undefined,
    });
    return r.json();
  } catch {
    return { error: 'Нет соединения' };
  }
};

type Stats = { total_users: number; online: number; total_messages: number; total_chats: number; new_today: number; new_week: number };
type User = { id: number; nick: string; avatar_url?: string | null; city?: string; is_online: boolean; last_seen?: string; created_at: string };

export default function Admin() {
  const [token, setToken] = useState(() => sessionStorage.getItem('adm_token') || '');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loginError, setLoginError] = useState('');
  const [tab, setTab] = useState<'stats' | 'users' | 'broadcast' | 'ad'>('stats');
  const [stats, setStats] = useState<Stats | null>(null);
  const [users, setUsers] = useState<User[]>([]);
  const [usersTotal, setUsersTotal] = useState(0);
  const [usersSearch, setUsersSearch] = useState('');
  const [usersOffset, setUsersOffset] = useState(0);
  const [deleteConfirm, setDeleteConfirm] = useState<number | null>(null);
  const [broadText, setBroadText] = useState('');
  const [broadImg, setBroadImg] = useState<string | null>(null);
  const [broadSending, setBroadSending] = useState(false);
  const [broadResult, setBroadResult] = useState('');
  const [adText, setAdText] = useState('');
  const [adImg, setAdImg] = useState<string | null>(null);
  const [adSending, setAdSending] = useState(false);
  const [adResult, setAdResult] = useState('');
  const broadFileRef = useRef<HTMLInputElement>(null);
  const adFileRef = useRef<HTMLInputElement>(null);

  const isAuth = !!token;

  const doLogin = async () => {
    setLoginError('');
    const d = await api('login', 'POST', { email, password });
    if (d.error) { setLoginError(d.error); return; }
    sessionStorage.setItem('adm_token', d.token);
    setToken(d.token);
  };

  const doLogout = () => {
    sessionStorage.removeItem('adm_token');
    setToken('');
  };

  // Загрузка статистики
  useEffect(() => {
    if (!isAuth || tab !== 'stats') return;
    api('stats', 'GET', undefined, token).then(d => {
      if (d.error) return;
      setStats(d as Stats);
    });
  }, [isAuth, tab, token]);

  // Загрузка пользователей
  useEffect(() => {
    if (!isAuth || tab !== 'users') return;
    api(`users&q=${encodeURIComponent(usersSearch)}&offset=${usersOffset}`, 'GET', undefined, token).then(d => {
      if (d.error) return;
      setUsers((d.users as User[]) || []);
      setUsersTotal(Number(d.total) || 0);
    });
  }, [isAuth, tab, token, usersSearch, usersOffset]);

  const deleteUser = async (uid: number) => {
    await api('delete_user', 'POST', { user_id: uid, token }, token);
    setDeleteConfirm(null);
    setUsers(u => u.filter(x => x.id !== uid));
    setUsersTotal(t => t - 1);
  };

  const pickFile = (setter: (v: string) => void) => (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => setter(reader.result as string);
    reader.readAsDataURL(file);
  };

  const uploadAndGetUrl = async (base64: string): Promise<string | null> => {
    const [header, data] = base64.split(',');
    const ext = header.includes('png') ? 'png' : 'jpg';
    const d = await api('upload_media', 'POST', { data, ext, token }, token);
    return d.url as string | null;
  };

  const sendBroadcast = async (isAd: boolean) => {
    const text = isAd ? adText : broadText;
    const img = isAd ? adImg : broadImg;
    const setter = isAd ? setAdSending : setBroadSending;
    const resultSetter = isAd ? setAdResult : setBroadResult;
    if (!text && !img) return;
    setter(true);
    resultSetter('');
    let image_url: string | null = null;
    if (img) image_url = await uploadAndGetUrl(img);
    const d = await api('broadcast', 'POST', { text: text || null, image_url, is_ad: isAd, token }, token);
    setter(false);
    if (d.ok) {
      resultSetter(`✅ Отправлено ${d.sent} пользователям`);
      if (isAd) { setAdText(''); setAdImg(null); }
      else { setBroadText(''); setBroadImg(null); }
    } else {
      resultSetter(`❌ Ошибка: ${d.error}`);
    }
  };

  const fmtDate = (iso: string) => new Date(iso).toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit' });

  // ── Экран входа ──────────────────────────────────────────────────────────
  if (!isAuth) return (
    <div className="min-h-screen flex items-center justify-center" style={{ background: 'linear-gradient(135deg, #0f172a 0%, #1e3a8a 100%)' }}>
      <div className="bg-white rounded-3xl p-8 w-full max-w-sm shadow-2xl">
        <div className="flex items-center gap-3 mb-6">
          <div className="w-10 h-10 rounded-2xl bg-blue-600 flex items-center justify-center">
            <Icon name="Shield" size={20} className="text-white" />
          </div>
          <div>
            <h1 className="font-bold text-lg text-slate-800">Вай Мессенджер</h1>
            <p className="text-xs text-slate-400">Панель администратора</p>
          </div>
        </div>
        <div className="space-y-3">
          <input value={email} onChange={e => setEmail(e.target.value)} type="email" placeholder="Email"
            className="w-full bg-slate-50 border-2 border-slate-200 rounded-2xl px-4 py-3 outline-none focus:border-blue-500 text-sm transition-all" />
          <input value={password} onChange={e => setPassword(e.target.value)} type="password" placeholder="Пароль"
            onKeyDown={e => e.key === 'Enter' && doLogin()}
            className="w-full bg-slate-50 border-2 border-slate-200 rounded-2xl px-4 py-3 outline-none focus:border-blue-500 text-sm transition-all" />
          {loginError && <p className="text-red-500 text-sm">{loginError}</p>}
          <button onClick={doLogin}
            className="w-full py-3.5 rounded-2xl font-bold text-white text-sm"
            style={{ background: 'linear-gradient(135deg,#2563eb,#1d4ed8)' }}>
            Войти
          </button>
        </div>
      </div>
    </div>
  );

  // ── Основная панель ──────────────────────────────────────────────────────
  const tabBtn = (key: typeof tab, icon: string, label: string) => (
    <button onClick={() => setTab(key)}
      className={`flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-semibold transition-all ${tab === key ? 'bg-blue-600 text-white shadow-md' : 'text-slate-500 hover:bg-slate-100'}`}>
      <Icon name={icon} size={16} />
      {label}
    </button>
  );

  return (
    <div className="min-h-screen" style={{ background: '#f0f4fa' }}>
      {/* Шапка */}
      <header className="bg-blue-600 px-6 py-4 flex items-center justify-between shadow-lg">
        <div className="flex items-center gap-3">
          <Icon name="Shield" size={22} className="text-white" />
          <span className="font-bold text-white text-lg">Вай Мессенджер — Админ</span>
        </div>
        <button onClick={doLogout} className="flex items-center gap-2 text-blue-100 hover:text-white text-sm transition-colors">
          <Icon name="LogOut" size={16} />
          Выйти
        </button>
      </header>

      <div className="max-w-5xl mx-auto px-4 py-6">
        {/* Навигация */}
        <div className="flex gap-2 flex-wrap mb-6 bg-white p-2 rounded-2xl border border-slate-100">
          {tabBtn('stats', 'BarChart2', 'Статистика')}
          {tabBtn('users', 'Users', 'Пользователи')}
          {tabBtn('broadcast', 'Send', 'Рассылка')}
          {tabBtn('ad', 'Megaphone', 'Реклама')}
        </div>

        {/* ── СТАТИСТИКА ── */}
        {tab === 'stats' && (
          <div>
            <h2 className="font-bold text-xl text-slate-800 mb-4">Статистика</h2>
            {!stats ? (
              <div className="flex justify-center py-12"><div className="w-8 h-8 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" /></div>
            ) : (
              <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
                {[
                  { label: 'Всего пользователей', value: stats.total_users, icon: 'Users', color: 'bg-blue-500' },
                  { label: 'Онлайн сейчас', value: stats.online, icon: 'Wifi', color: 'bg-green-500' },
                  { label: 'Новых за сегодня', value: stats.new_today, icon: 'UserPlus', color: 'bg-purple-500' },
                  { label: 'Новых за неделю', value: stats.new_week, icon: 'TrendingUp', color: 'bg-orange-500' },
                  { label: 'Всего сообщений', value: stats.total_messages, icon: 'MessageCircle', color: 'bg-cyan-500' },
                  { label: 'Всего чатов', value: stats.total_chats, icon: 'MessagesSquare', color: 'bg-pink-500' },
                ].map(s => (
                  <div key={s.label} className="bg-white rounded-2xl p-5 border border-slate-100 shadow-sm">
                    <div className={`w-10 h-10 ${s.color} rounded-xl flex items-center justify-center mb-3`}>
                      <Icon name={s.icon} size={18} className="text-white" />
                    </div>
                    <div className="text-3xl font-bold text-slate-800">{s.value}</div>
                    <div className="text-xs text-slate-400 mt-1">{s.label}</div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* ── ПОЛЬЗОВАТЕЛИ ── */}
        {tab === 'users' && (
          <div>
            <div className="flex items-center justify-between mb-4 flex-wrap gap-2">
              <h2 className="font-bold text-xl text-slate-800">Пользователи <span className="text-slate-400 font-normal text-base">({usersTotal})</span></h2>
              <div className="relative">
                <Icon name="Search" size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                <input value={usersSearch} onChange={e => { setUsersSearch(e.target.value); setUsersOffset(0); }}
                  placeholder="Поиск по нику..."
                  className="bg-white border border-slate-200 rounded-xl pl-9 pr-4 py-2.5 outline-none focus:border-blue-500 text-sm w-56" />
              </div>
            </div>

            <div className="bg-white rounded-2xl border border-slate-100 overflow-hidden">
              {users.length === 0 && <div className="py-12 text-center text-slate-400">Нет пользователей</div>}
              {users.map((u, i) => (
                <div key={u.id} className={`flex items-center gap-3 px-4 py-3 ${i < users.length - 1 ? 'border-b border-slate-50' : ''}`}>
                  <div className="w-10 h-10 rounded-full bg-blue-100 flex items-center justify-center flex-shrink-0 overflow-hidden">
                    {u.avatar_url
                      ? <img src={u.avatar_url} className="w-full h-full object-cover" />
                      : <span className="text-blue-600 font-bold text-sm">{u.nick[0]?.toUpperCase()}</span>
                    }
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="font-semibold text-slate-800 text-sm">@{u.nick}</span>
                      {u.is_online && <span className="w-2 h-2 rounded-full bg-green-400 shrink-0" />}
                    </div>
                    <div className="text-xs text-slate-400">{u.city || '—'} · зарег. {fmtDate(u.created_at)}</div>
                  </div>
                  <div className="shrink-0">
                    {deleteConfirm === u.id ? (
                      <div className="flex gap-2 items-center">
                        <span className="text-xs text-slate-500">Удалить?</span>
                        <button onClick={() => deleteUser(u.id)}
                          className="px-3 py-1.5 bg-red-500 text-white text-xs font-bold rounded-lg">Да</button>
                        <button onClick={() => setDeleteConfirm(null)}
                          className="px-3 py-1.5 bg-slate-100 text-slate-600 text-xs font-medium rounded-lg">Нет</button>
                      </div>
                    ) : (
                      <button onClick={() => setDeleteConfirm(u.id)}
                        className="w-8 h-8 rounded-xl hover:bg-red-50 flex items-center justify-center transition-colors">
                        <Icon name="Trash2" size={15} className="text-red-400" />
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>

            {/* Пагинация */}
            {usersTotal > 50 && (
              <div className="flex gap-2 justify-center mt-4">
                <button onClick={() => setUsersOffset(Math.max(0, usersOffset - 50))} disabled={usersOffset === 0}
                  className="px-4 py-2 bg-white border border-slate-200 rounded-xl text-sm disabled:opacity-40">← Назад</button>
                <span className="px-4 py-2 text-sm text-slate-500">{Math.floor(usersOffset / 50) + 1} / {Math.ceil(usersTotal / 50)}</span>
                <button onClick={() => setUsersOffset(usersOffset + 50)} disabled={usersOffset + 50 >= usersTotal}
                  className="px-4 py-2 bg-white border border-slate-200 rounded-xl text-sm disabled:opacity-40">Вперёд →</button>
              </div>
            )}
          </div>
        )}

        {/* ── РАССЫЛКА ── */}
        {tab === 'broadcast' && (
          <div>
            <h2 className="font-bold text-xl text-slate-800 mb-1">Рассылка</h2>
            <p className="text-slate-400 text-sm mb-5">Сообщение придёт всем пользователям от имени <strong>vaimessenger</strong></p>
            <div className="bg-white rounded-2xl p-6 border border-slate-100 space-y-4">
              <div>
                <label className="text-xs font-semibold text-slate-500 mb-2 block">Текст сообщения</label>
                <textarea value={broadText} onChange={e => setBroadText(e.target.value)} rows={4}
                  placeholder="Введи текст рассылки..."
                  className="w-full bg-slate-50 border-2 border-slate-200 rounded-2xl px-4 py-3 outline-none focus:border-blue-500 text-sm resize-none" />
              </div>
              <div>
                <label className="text-xs font-semibold text-slate-500 mb-2 block">Изображение (необязательно)</label>
                <input ref={broadFileRef} type="file" accept="image/*" hidden onChange={pickFile(setBroadImg)} />
                {broadImg ? (
                  <div className="relative w-40">
                    <img src={broadImg} className="w-40 h-28 object-cover rounded-xl" />
                    <button onClick={() => setBroadImg(null)}
                      className="absolute -top-2 -right-2 w-6 h-6 bg-red-500 rounded-full flex items-center justify-center">
                      <Icon name="X" size={12} className="text-white" />
                    </button>
                  </div>
                ) : (
                  <button onClick={() => broadFileRef.current?.click()}
                    className="flex items-center gap-2 px-4 py-3 bg-slate-50 border-2 border-dashed border-slate-200 rounded-2xl text-slate-400 text-sm hover:border-blue-400 transition-colors">
                    <Icon name="Image" size={16} />Прикрепить фото
                  </button>
                )}
              </div>
              {broadResult && <p className="text-sm font-medium">{broadResult}</p>}
              <button onClick={() => sendBroadcast(false)} disabled={broadSending || (!broadText && !broadImg)}
                className="w-full py-4 rounded-2xl font-bold text-white text-sm disabled:opacity-40 flex items-center justify-center gap-2"
                style={{ background: 'linear-gradient(135deg,#2563eb,#1d4ed8)' }}>
                <Icon name="Send" size={16} />
                {broadSending ? 'Отправляю...' : 'Отправить всем'}
              </button>
            </div>
          </div>
        )}

        {/* ── РЕКЛАМА ── */}
        {tab === 'ad' && (
          <div>
            <h2 className="font-bold text-xl text-slate-800 mb-1">Реклама</h2>
            <p className="text-slate-400 text-sm mb-5">Сообщение придёт всем пользователям от имени <strong>vaimessenger Реклама</strong></p>
            <div className="bg-white rounded-2xl p-6 border border-slate-100 space-y-4">
              <div>
                <label className="text-xs font-semibold text-slate-500 mb-2 block">Текст рекламы</label>
                <textarea value={adText} onChange={e => setAdText(e.target.value)} rows={4}
                  placeholder="Текст рекламного сообщения..."
                  className="w-full bg-slate-50 border-2 border-slate-200 rounded-2xl px-4 py-3 outline-none focus:border-blue-500 text-sm resize-none" />
              </div>
              <div>
                <label className="text-xs font-semibold text-slate-500 mb-2 block">Изображение (необязательно)</label>
                <input ref={adFileRef} type="file" accept="image/*" hidden onChange={pickFile(setAdImg)} />
                {adImg ? (
                  <div className="relative w-40">
                    <img src={adImg} className="w-40 h-28 object-cover rounded-xl" />
                    <button onClick={() => setAdImg(null)}
                      className="absolute -top-2 -right-2 w-6 h-6 bg-red-500 rounded-full flex items-center justify-center">
                      <Icon name="X" size={12} className="text-white" />
                    </button>
                  </div>
                ) : (
                  <button onClick={() => adFileRef.current?.click()}
                    className="flex items-center gap-2 px-4 py-3 bg-slate-50 border-2 border-dashed border-slate-200 rounded-2xl text-slate-400 text-sm hover:border-blue-400 transition-colors">
                    <Icon name="Image" size={16} />Прикрепить фото
                  </button>
                )}
              </div>
              {adResult && <p className="text-sm font-medium">{adResult}</p>}
              <button onClick={() => sendBroadcast(true)} disabled={adSending || (!adText && !adImg)}
                className="w-full py-4 rounded-2xl font-bold text-white text-sm disabled:opacity-40 flex items-center justify-center gap-2"
                style={{ background: 'linear-gradient(135deg,#7c3aed,#5b21b6)' }}>
                <Icon name="Megaphone" size={16} />
                {adSending ? 'Отправляю...' : 'Отправить рекламу всем'}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
