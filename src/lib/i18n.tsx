import { createContext, useContext, useState, useCallback, ReactNode } from 'react';
import { translations } from './translations';

export type Lang = 'ru' | 'en';

interface LangContextValue {
  lang: Lang;
  setLang: (l: Lang) => void;
  t: (ru: string) => string;
}

const LangContext = createContext<LangContextValue | null>(null);

export function LanguageProvider({ children }: { children: ReactNode }) {
  const [lang, setLangState] = useState<Lang>(() => (localStorage.getItem('orbit_lang') as Lang) || 'ru');

  const setLang = useCallback((l: Lang) => {
    setLangState(l);
    localStorage.setItem('orbit_lang', l);
  }, []);

  const t = useCallback((ru: string) => {
    if (lang === 'ru') return ru;
    return translations[ru] || ru;
  }, [lang]);

  return (
    <LangContext.Provider value={{ lang, setLang, t }}>
      {children}
    </LangContext.Provider>
  );
}

export function useLang() {
  const ctx = useContext(LangContext);
  if (!ctx) throw new Error('useLang must be used within LanguageProvider');
  return ctx;
}
