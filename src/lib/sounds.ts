// Звуки интерфейса через Web Audio API (без файлов — мгновенная загрузка)

let ctx: AudioContext | null = null;
const getCtx = () => {
  if (!ctx) {
    const AC = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    ctx = new AC();
  }
  if (ctx.state === 'suspended') ctx.resume();
  return ctx;
};

// Короткий "вжух" при отправке сообщения (как в WhatsApp)
export const playSendSound = () => {
  try {
    const ac = getCtx();
    const now = ac.currentTime;

    const osc = ac.createOscillator();
    const gain = ac.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(900, now);
    osc.frequency.exponentialRampToValueAtTime(1400, now + 0.08);
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(0.25, now + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.12);
    osc.connect(gain).connect(ac.destination);
    osc.start(now);
    osc.stop(now + 0.13);
  } catch {/* ignore */}
};

// Короткий "тук" при получении сообщения
export const playReceiveSound = () => {
  try {
    const ac = getCtx();
    const now = ac.currentTime;

    const osc = ac.createOscillator();
    const gain = ac.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(600, now);
    osc.frequency.exponentialRampToValueAtTime(420, now + 0.1);
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(0.2, now + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.15);
    osc.connect(gain).connect(ac.destination);
    osc.start(now);
    osc.stop(now + 0.16);
  } catch {/* ignore */}
};

// Гудки при исходящем звонке (как в WhatsApp) — повторяющийся "бип-бип ... тишина"
let ringbackTimer: ReturnType<typeof setInterval> | null = null;

const ringOnce = () => {
  try {
    const ac = getCtx();
    const now = ac.currentTime;
    [0, 0.4].forEach(offset => {
      const osc = ac.createOscillator();
      const gain = ac.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(425, now + offset);
      gain.gain.setValueAtTime(0.0001, now + offset);
      gain.gain.exponentialRampToValueAtTime(0.15, now + offset + 0.02);
      gain.gain.setValueAtTime(0.15, now + offset + 0.35);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + offset + 0.38);
      osc.connect(gain).connect(ac.destination);
      osc.start(now + offset);
      osc.stop(now + offset + 0.4);
    });
  } catch {/* ignore */}
};

export const startRingback = () => {
  if (ringbackTimer) return;
  ringOnce();
  ringbackTimer = setInterval(ringOnce, 3000);
};

export const stopRingback = () => {
  if (ringbackTimer) { clearInterval(ringbackTimer); ringbackTimer = null; }
};