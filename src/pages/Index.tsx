import { useState, useRef, useEffect, useCallback } from 'react';
import Icon from '@/components/ui/icon';
import { Button } from '@/components/ui/button';

const API = 'https://functions.poehali.dev/b927178a-1937-4d4d-8fd6-2a1ffe4d52be';

type User = { id: number; nick: string };
type ChatItem = {
  chat_id: number;
  peer_id: number;
  peer_nick: string;
  last_text: string | null;
  last_image: string | null;
  last_at: string | null;
};
type Message = {
  id: number;
  sender_id: number;
  text: string | null;
  image_url: string | null;
  created_at: string;
};
type View = 'list' | 'search' | 'chat';

const fmtTime = (iso: string | null) => {
  if (!iso) return '';
  return new Date(iso).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
};

export default function Index() {
  const [user, setUser] = useState<User | null>(() => {
    const raw = localStorage.getItem('orbit_user');
    return raw ? JSON.parse(raw) : null;
  });
  const [draftNick, setDraftNick] = useState('');
  const [view, setView] = useState<View>('list');

  const [chats, setChats] = useState<ChatItem[]>([]);

  const [query, setQuery] = useState('');
  const [results, setResults] = useState<User[]>([]);

  const [chatId, setChatId] = useState<number | null>(null);
  const [peer, setPeer] = useState<User | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');

  const endRef = useRef<HTMLDivElement>(null);
  const lastIdRef = useRef(0);

  const login = async () => {
    const nick = draftNick.trim().toLowerCase();
    if (nick.length < 2) return;
    const r = await fetch(`${API}?action=login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ nick }),
    });
    const data = await r.json();
    if (data.user) {
      setUser(data.user);
      localStorage.setItem('orbit_user', JSON.stringify(data.user));
    }
  };

  const logout = () => {
    localStorage.removeItem('orbit_user');
    setUser(null);
    setView('list');
    setChats([]);
    setChatId(null);
  };

  const loadChats = useCallback(async () => {
    if (!user) return;
    const r = await fetch(`${API}?action=chats&user_id=${user.id}`);
    const data = await r.json();
    setChats(data.chats || []);
  }, [user]);

  useEffect(() => {
    if (user && view === 'list') loadChats();
  }, [user, view, loadChats]);

  useEffect(() => {
    if (view !== 'search' || !user) return;
    const q = query.trim();
    if (!q) { setResults([]); return; }
    const t = setTimeout(async () => {
      const r = await fetch(`${API}?action=search&q=${encodeURIComponent(q)}&user_id=${user.id}`);
      const data = await r.json();
      setResults(data.users || []);
    }, 250);
    return () => clearTimeout(t);
  }, [query, view, user]);

  const openChat = async (peerId: number) => {
    if (!user) return;
    const r = await fetch(`${API}?action=open_chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ user_id: user.id, peer_id: peerId }),
    });
    const data = await r.json();
    setChatId(data.chat_id);
    setPeer(data.peer);
    setMessages([]);
    lastIdRef.current = 0;
    setView('chat');
    setQuery('');
    setResults([]);
  };

  useEffect(() => {
    if (view !== 'chat' || !chatId) return;
    let alive = true;
    const poll = async () => {
      const r = await fetch(`${API}?action=messages&chat_id=${chatId}&after=${lastIdRef.current}`);
      const data = await r.json();
      if (!alive) return;
      const fresh: Message[] = data.messages || [];
      if (fresh.length) {
        lastIdRef.current = fresh[fresh.length - 1].id;
        setMessages((m) => [...m, ...fresh]);
      }
    };
    poll();
    const iv = setInterval(poll, 1500);
    return () => { alive = false; clearInterval(iv); };
  }, [view, chatId]);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const send = async () => {
    if (!input.trim() || !chatId || !user) return;
    const text = input.trim();
    setInput('');
    await fetch(`${API}?action=send`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, user_id: user.id, text }),
    });
  };

  if (!user) {
    return (
      <div className="min-h-screen grad-mesh relative overflow-hidden flex items-center justify-center p-6">
        <div className="absolute top-1/4 -left-20 w-96 h-96 rounded-full bg-primary/30 blur-[120px] animate-float" />
        <div className="absolute bottom-1/4 -right-20 w-96 h-96 rounded-full bg-accent/20 blur-[120px] animate-float" style={{ animationDelay: '2s' }} />
        <div className="relative w-full max-w-md animate-fade-up">
          <div className="flex items-center justify-center gap-3 mb-10">
            <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-primary to-accent flex items-center justify-center shadow-lg shadow-primary/30">
              <Icon name="Send" className="text-white" size={22} />
            </div>
            <span className="font-display font-bold text-2xl tracking-tight">Orbit</span>
          </div>
          <div className="glass rounded-3xl p-8 shadow-2xl">
            <h1 className="font-display font-extrabold text-3xl leading-tight mb-2">
              Войди в <span className="text-gradient">Orbit</span>
            </h1>
            <p className="text-muted-foreground mb-8">Придумай ник — и найди друзей по нику</p>
            <div className="relative mb-6">
              <span className="absolute left-4 top-1/2 -translate-y-1/2 text-muted-foreground">@</span>
              <input
                value={draftNick}
                onChange={(e) => setDraftNick(e.target.value.replace(/\s/g, ''))}
                onKeyDown={(e) => e.key === 'Enter' && login()}
                placeholder="cosmonaut"
                className="w-full bg-secondary/60 border border-border rounded-2xl pl-9 pr-4 py-3.5 outline-none focus:ring-2 focus:ring-primary transition-all"
              />
            </div>
            <Button
              disabled={draftNick.trim().length < 2}
              onClick={login}
              className="w-full py-6 rounded-2xl text-base font-semibold bg-gradient-to-r from-primary to-accent hover:opacity-90 transition-all shadow-lg shadow-primary/30"
            >
              Поехали <Icon name="ArrowRight" size={18} className="ml-1" />
            </Button>
          </div>
        </div>
      </div>
    );
  }

  if (view === 'chat' && peer) {
    return (
      <div className="min-h-screen grad-mesh flex flex-col">
        <header className="flex items-center gap-3 px-4 py-3 glass">
          <button onClick={() => setView('list')} className="w-10 h-10 rounded-full hover:bg-secondary/60 flex items-center justify-center transition-colors">
            <Icon name="ArrowLeft" size={20} />
          </button>
          <div className="w-10 h-10 rounded-full bg-gradient-to-br from-accent to-primary flex items-center justify-center font-display font-bold text-white">
            {peer.nick.slice(0, 1).toUpperCase()}
          </div>
          <div className="flex-1">
            <div className="font-semibold">@{peer.nick}</div>
            <div className="text-xs text-green-400">в сети</div>
          </div>
          <button className="w-10 h-10 rounded-full bg-gradient-to-br from-primary to-accent flex items-center justify-center shadow-lg shadow-primary/30">
            <Icon name="Video" size={18} className="text-white" />
          </button>
        </header>

        <main className="flex-1 overflow-y-auto scrollbar-thin px-4 py-5 space-y-3">
          {messages.length === 0 && (
            <div className="text-center text-muted-foreground mt-10 text-sm">
              Напиши первое сообщение @{peer.nick} 👋
            </div>
          )}
          {messages.map((m) => {
            const mine = m.sender_id === user.id;
            return (
              <div key={m.id} className={`flex ${mine ? 'justify-end' : 'justify-start'} animate-msg-in`}>
                <div className={`max-w-[75%] rounded-3xl px-4 py-2.5 ${mine ? 'bg-gradient-to-br from-primary to-accent text-white rounded-br-md' : 'bg-secondary/70 rounded-bl-md'}`}>
                  {m.image_url ? (
                    <img src={m.image_url} alt="" className="rounded-2xl max-h-60 mb-1" />
                  ) : (
                    <p className="leading-relaxed break-words">{m.text}</p>
                  )}
                  <span className={`block text-[10px] mt-1 ${mine ? 'text-white/70' : 'text-muted-foreground'}`}>{fmtTime(m.created_at)}</span>
                </div>
              </div>
            );
          })}
          <div ref={endRef} />
        </main>

        <div className="flex items-center gap-2 p-3 glass">
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && send()}
            placeholder="Напиши сообщение…"
            className="flex-1 bg-secondary/60 border border-border rounded-full px-5 py-3 outline-none focus:ring-2 focus:ring-primary transition-all"
          />
          <button onClick={send} className="w-11 h-11 shrink-0 rounded-full bg-gradient-to-br from-primary to-accent hover:opacity-90 flex items-center justify-center shadow-lg shadow-primary/30">
            <Icon name="Send" size={18} className="text-white" />
          </button>
        </div>
      </div>
    );
  }

  if (view === 'search') {
    return (
      <div className="min-h-screen grad-mesh flex flex-col">
        <header className="flex items-center gap-3 px-4 py-3 glass">
          <button onClick={() => { setView('list'); setQuery(''); setResults([]); }} className="w-10 h-10 rounded-full hover:bg-secondary/60 flex items-center justify-center transition-colors">
            <Icon name="ArrowLeft" size={20} />
          </button>
          <div className="relative flex-1">
            <Icon name="Search" size={18} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <input
              autoFocus
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Найти человека по нику…"
              className="w-full bg-secondary/60 border border-border rounded-full pl-10 pr-4 py-2.5 outline-none focus:ring-2 focus:ring-primary transition-all"
            />
          </div>
        </header>
        <main className="flex-1 overflow-y-auto scrollbar-thin p-3">
          {query.trim() && results.length === 0 && (
            <div className="text-center text-muted-foreground mt-10 text-sm">Никого не нашли по «{query}»</div>
          )}
          {results.map((u) => (
            <button key={u.id} onClick={() => openChat(u.id)} className="w-full flex items-center gap-3 p-3 rounded-2xl hover:bg-secondary/50 transition-colors animate-fade-up">
              <div className="w-12 h-12 rounded-full bg-gradient-to-br from-accent to-primary flex items-center justify-center font-display font-bold text-white">
                {u.nick.slice(0, 1).toUpperCase()}
              </div>
              <div className="flex-1 text-left font-medium">@{u.nick}</div>
              <Icon name="MessageCirclePlus" size={20} className="text-accent" />
            </button>
          ))}
        </main>
      </div>
    );
  }

  return (
    <div className="min-h-screen grad-mesh flex flex-col">
      <header className="flex items-center justify-between px-4 py-4 glass">
        <div className="flex items-center gap-2.5">
          <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-primary to-accent flex items-center justify-center shadow-lg shadow-primary/30">
            <Icon name="Send" className="text-white" size={18} />
          </div>
          <span className="font-display font-bold text-xl tracking-tight">Orbit</span>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-2 rounded-full glass pl-2 pr-3 py-1.5">
            <div className="w-7 h-7 rounded-full bg-gradient-to-br from-accent to-primary flex items-center justify-center font-bold text-xs text-white">
              {user.nick.slice(0, 1).toUpperCase()}
            </div>
            <span className="font-medium text-sm">@{user.nick}</span>
          </div>
          <button onClick={logout} className="w-9 h-9 rounded-full hover:bg-destructive/10 flex items-center justify-center transition-colors">
            <Icon name="LogOut" size={18} className="text-destructive" />
          </button>
        </div>
      </header>

      <main className="flex-1 overflow-y-auto scrollbar-thin p-3">
        {chats.length === 0 && (
          <div className="text-center text-muted-foreground mt-16">
            <Icon name="MessagesSquare" size={48} className="mx-auto mb-3 opacity-40" />
            <p>Пока нет чатов</p>
            <p className="text-sm mt-1">Найди друга по нику и начни общение</p>
          </div>
        )}
        {chats.map((c) => (
          <button key={c.chat_id} onClick={() => openChat(c.peer_id)} className="w-full flex items-center gap-3 p-3 rounded-2xl hover:bg-secondary/50 transition-colors animate-fade-up">
            <div className="w-12 h-12 rounded-full bg-gradient-to-br from-accent to-primary flex items-center justify-center font-display font-bold text-white">
              {c.peer_nick.slice(0, 1).toUpperCase()}
            </div>
            <div className="flex-1 min-w-0 text-left">
              <div className="font-semibold">@{c.peer_nick}</div>
              <div className="text-sm text-muted-foreground truncate">
                {c.last_image ? '📷 Фото' : c.last_text || 'Нет сообщений'}
              </div>
            </div>
            <span className="text-[11px] text-muted-foreground shrink-0">{fmtTime(c.last_at)}</span>
          </button>
        ))}
      </main>

      <button
        onClick={() => setView('search')}
        className="fixed bottom-6 right-6 p-4 rounded-full bg-gradient-to-br from-primary to-accent flex items-center justify-center shadow-xl shadow-primary/40 hover:scale-105 transition-transform"
      >
        <Icon name="Plus" size={26} className="text-white" />
      </button>
    </div>
  );
}
