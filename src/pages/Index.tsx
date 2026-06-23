import { useState, useRef, useEffect } from 'react';
import Icon from '@/components/ui/icon';
import { Button } from '@/components/ui/button';

type Message = {
  id: number;
  author: 'me' | 'them';
  text?: string;
  image?: string;
  time: string;
};

type Screen = 'login' | 'chat' | 'profile';

const demoMessages: Message[] = [
  { id: 1, author: 'them', text: 'Привет! Зашёл по твоей ссылке 🚀', time: '14:02' },
  { id: 2, author: 'me', text: 'Отлично! Теперь можем переписываться и звонить', time: '14:03' },
  { id: 3, author: 'them', text: 'Кидай мемы 😄', time: '14:03' },
];

const now = () =>
  new Date().toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });

export default function Index() {
  const [screen, setScreen] = useState<Screen>('login');
  const [nick, setNick] = useState('');
  const [draftNick, setDraftNick] = useState('');
  const [messages, setMessages] = useState<Message[]>(demoMessages);
  const [input, setInput] = useState('');
  const [inCall, setInCall] = useState(false);
  const [copied, setCopied] = useState(false);
  const endRef = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const inviteLink = nick
    ? `${window.location.origin}/join/${encodeURIComponent(nick.toLowerCase())}`
    : '';

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, screen]);

  const send = () => {
    if (!input.trim()) return;
    setMessages((m) => [
      ...m,
      { id: Date.now(), author: 'me', text: input.trim(), time: now() },
    ]);
    setInput('');
  };

  const sendImage = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const url = URL.createObjectURL(file);
    setMessages((m) => [
      ...m,
      { id: Date.now(), author: 'me', image: url, time: now() },
    ]);
    e.target.value = '';
  };

  const copyLink = () => {
    navigator.clipboard?.writeText(inviteLink);
    setCopied(true);
    setTimeout(() => setCopied(false), 1800);
  };

  // ---------- LOGIN ----------
  if (screen === 'login') {
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
            <p className="text-muted-foreground mb-8">
              Придумай ник, поделись ссылкой и начни общаться
            </p>

            <label className="block text-sm font-medium text-muted-foreground mb-2">
              Твой ник
            </label>
            <div className="relative mb-6">
              <span className="absolute left-4 top-1/2 -translate-y-1/2 text-muted-foreground">@</span>
              <input
                value={draftNick}
                onChange={(e) => setDraftNick(e.target.value.replace(/\s/g, ''))}
                onKeyDown={(e) => e.key === 'Enter' && draftNick && (setNick(draftNick), setScreen('chat'))}
                placeholder="cosmonaut"
                className="w-full bg-secondary/60 border border-border rounded-2xl pl-9 pr-4 py-3.5 outline-none focus:ring-2 focus:ring-primary transition-all"
              />
            </div>

            <Button
              disabled={!draftNick}
              onClick={() => { setNick(draftNick); setScreen('chat'); }}
              className="w-full py-6 rounded-2xl text-base font-semibold bg-gradient-to-r from-primary to-accent hover:opacity-90 transition-all shadow-lg shadow-primary/30"
            >
              Поехали
              <Icon name="ArrowRight" size={18} className="ml-1" />
            </Button>

            <div className="flex items-center gap-6 mt-8 justify-center text-muted-foreground text-sm">
              <span className="flex items-center gap-1.5"><Icon name="MessageCircle" size={16} /> Чат</span>
              <span className="flex items-center gap-1.5"><Icon name="Video" size={16} /> Видео</span>
              <span className="flex items-center gap-1.5"><Icon name="Link2" size={16} /> Ссылки</span>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // ---------- PROFILE ----------
  if (screen === 'profile') {
    return (
      <div className="min-h-screen grad-mesh flex flex-col">
        <Header nick={nick} onProfile={() => setScreen('chat')} active="profile" />
        <div className="flex-1 flex justify-center p-6">
          <div className="w-full max-w-lg animate-fade-up">
            <div className="glass rounded-3xl p-8">
              <div className="flex flex-col items-center mb-8">
                <div className="w-24 h-24 rounded-full bg-gradient-to-br from-primary to-accent flex items-center justify-center text-3xl font-display font-bold text-white shadow-lg shadow-primary/30 mb-4">
                  {nick.slice(0, 1).toUpperCase()}
                </div>
                <h2 className="font-display font-bold text-2xl">@{nick}</h2>
                <p className="text-muted-foreground text-sm mt-1">В сети</p>
              </div>

              {[
                { icon: 'Bell', label: 'Push-уведомления', sub: 'Сообщения и звонки' },
                { icon: 'Moon', label: 'Тёмная тема', sub: 'Всегда включена' },
                { icon: 'Shield', label: 'Приватность', sub: 'Только по ссылке' },
              ].map((row) => (
                <div key={row.label} className="flex items-center gap-4 py-4 border-b border-border last:border-0">
                  <div className="w-10 h-10 rounded-xl bg-secondary/60 flex items-center justify-center">
                    <Icon name={row.icon} size={18} className="text-accent" />
                  </div>
                  <div className="flex-1">
                    <div className="font-medium">{row.label}</div>
                    <div className="text-xs text-muted-foreground">{row.sub}</div>
                  </div>
                  <div className="w-11 h-6 rounded-full bg-primary/80 relative">
                    <div className="absolute right-0.5 top-0.5 w-5 h-5 rounded-full bg-white" />
                  </div>
                </div>
              ))}

              <Button
                onClick={() => setScreen('login')}
                variant="ghost"
                className="w-full mt-6 rounded-2xl py-6 text-destructive hover:bg-destructive/10"
              >
                <Icon name="LogOut" size={18} className="mr-2" /> Выйти
              </Button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // ---------- CHAT ----------
  return (
    <div className="min-h-screen grad-mesh flex flex-col">
      <Header nick={nick} onProfile={() => setScreen('profile')} active="chat" />

      <main className="flex-1 flex justify-center px-3 md:px-6 pb-4">
        <div className="w-full max-w-3xl flex flex-col glass rounded-3xl overflow-hidden my-2 md:my-4">
          <div className="flex items-center gap-3 px-5 py-4 border-b border-border bg-secondary/30">
            <div className="relative">
              <div className="w-11 h-11 rounded-full bg-gradient-to-br from-accent to-primary flex items-center justify-center font-display font-bold text-white">A</div>
              <span className="absolute -bottom-0.5 -right-0.5 w-3.5 h-3.5 rounded-full bg-green-400 border-2 border-card" />
            </div>
            <div className="flex-1">
              <div className="font-semibold">Друг по ссылке</div>
              <div className="text-xs text-green-400">печатает…</div>
            </div>
            <button
              onClick={() => setInCall(true)}
              className="w-11 h-11 rounded-full bg-secondary/60 hover:bg-primary/30 flex items-center justify-center transition-colors"
            >
              <Icon name="Phone" size={18} />
            </button>
            <button
              onClick={() => setInCall(true)}
              className="w-11 h-11 rounded-full bg-gradient-to-br from-primary to-accent hover:opacity-90 flex items-center justify-center transition-opacity shadow-lg shadow-primary/30"
            >
              <Icon name="Video" size={18} className="text-white" />
            </button>
          </div>

          <div className="flex-1 overflow-y-auto scrollbar-thin px-4 py-5 space-y-3 min-h-[40vh] max-h-[55vh]">
            {messages.map((m) => (
              <div key={m.id} className={`flex ${m.author === 'me' ? 'justify-end' : 'justify-start'} animate-msg-in`}>
                <div
                  className={`max-w-[75%] rounded-3xl px-4 py-2.5 ${
                    m.author === 'me'
                      ? 'bg-gradient-to-br from-primary to-accent text-white rounded-br-md'
                      : 'bg-secondary/70 rounded-bl-md'
                  }`}
                >
                  {m.image ? (
                    <img src={m.image} alt="" className="rounded-2xl max-h-60 mb-1" />
                  ) : (
                    <p className="leading-relaxed break-words">{m.text}</p>
                  )}
                  <span className={`block text-[10px] mt-1 ${m.author === 'me' ? 'text-white/70' : 'text-muted-foreground'}`}>
                    {m.time}
                  </span>
                </div>
              </div>
            ))}
            <div ref={endRef} />
          </div>

          <div className="flex items-center gap-2 p-3 border-t border-border bg-secondary/30">
            <input ref={fileRef} type="file" accept="image/*" hidden onChange={sendImage} />
            <button
              onClick={() => fileRef.current?.click()}
              className="w-11 h-11 shrink-0 rounded-full bg-secondary/60 hover:bg-secondary flex items-center justify-center transition-colors"
            >
              <Icon name="ImagePlus" size={20} className="text-accent" />
            </button>
            <input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && send()}
              placeholder="Напиши сообщение…"
              className="flex-1 bg-secondary/60 border border-border rounded-full px-5 py-3 outline-none focus:ring-2 focus:ring-primary transition-all"
            />
            <button
              onClick={send}
              className="w-11 h-11 shrink-0 rounded-full bg-gradient-to-br from-primary to-accent hover:opacity-90 flex items-center justify-center transition-opacity shadow-lg shadow-primary/30"
            >
              <Icon name="Send" size={18} className="text-white" />
            </button>
          </div>
        </div>
      </main>

      <div className="flex justify-center px-3 md:px-6 pb-6">
        <div className="w-full max-w-3xl glass rounded-2xl p-4 flex items-center gap-3 animate-fade-up">
          <div className="w-10 h-10 rounded-xl bg-primary/20 flex items-center justify-center shrink-0">
            <Icon name="Link2" size={18} className="text-accent" />
          </div>
          <div className="flex-1 min-w-0">
            <div className="text-xs text-muted-foreground">Ссылка-приглашение</div>
            <div className="truncate text-sm font-medium">{inviteLink}</div>
          </div>
          <Button onClick={copyLink} className="rounded-xl bg-gradient-to-r from-primary to-accent hover:opacity-90 shrink-0">
            <Icon name={copied ? 'Check' : 'Copy'} size={16} className="mr-1" />
            {copied ? 'Готово' : 'Копировать'}
          </Button>
        </div>
      </div>

      {inCall && (
        <div className="fixed inset-0 z-50 bg-background/95 backdrop-blur-xl flex flex-col items-center justify-center p-6 animate-fade-up">
          <div className="relative mb-8">
            <span className="absolute inset-0 rounded-full bg-primary/40 animate-pulse-ring" />
            <span className="absolute inset-0 rounded-full bg-accent/30 animate-pulse-ring" style={{ animationDelay: '0.5s' }} />
            <div className="relative w-32 h-32 rounded-full bg-gradient-to-br from-primary to-accent flex items-center justify-center text-5xl font-display font-bold text-white shadow-2xl shadow-primary/40">
              A
            </div>
          </div>
          <h2 className="font-display font-bold text-2xl mb-1">Друг по ссылке</h2>
          <p className="text-muted-foreground mb-12">Соединяем видеозвонок…</p>

          <div className="flex items-center gap-5">
            <button className="w-14 h-14 rounded-full bg-secondary/70 hover:bg-secondary flex items-center justify-center transition-colors">
              <Icon name="Mic" size={22} />
            </button>
            <button className="w-14 h-14 rounded-full bg-secondary/70 hover:bg-secondary flex items-center justify-center transition-colors">
              <Icon name="Video" size={22} />
            </button>
            <button
              onClick={() => setInCall(false)}
              className="w-16 h-16 rounded-full bg-destructive hover:opacity-90 flex items-center justify-center transition-opacity shadow-lg shadow-destructive/40"
            >
              <Icon name="PhoneOff" size={26} className="text-white" />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function Header({
  nick,
  onProfile,
  active,
}: {
  nick: string;
  onProfile: () => void;
  active: 'chat' | 'profile';
}) {
  return (
    <header className="flex items-center justify-between px-4 md:px-6 py-4">
      <div className="flex items-center gap-2.5">
        <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-primary to-accent flex items-center justify-center shadow-lg shadow-primary/30">
          <Icon name="Send" className="text-white" size={18} />
        </div>
        <span className="font-display font-bold text-xl tracking-tight">Orbit</span>
      </div>
      <button
        onClick={onProfile}
        className={`flex items-center gap-2.5 rounded-full pl-2 pr-4 py-1.5 transition-colors ${
          active === 'profile' ? 'bg-primary/20' : 'glass hover:bg-secondary/60'
        }`}
      >
        <div className="w-8 h-8 rounded-full bg-gradient-to-br from-accent to-primary flex items-center justify-center font-bold text-sm text-white">
          {nick.slice(0, 1).toUpperCase()}
        </div>
        <span className="font-medium text-sm">@{nick}</span>
      </button>
    </header>
  );
}
