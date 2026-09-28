import React, { useEffect, useState } from 'react';
import { Laptop, Moon, Sun } from 'lucide-react';

export type ThemePreference = 'light' | 'dark' | 'system';

const STORAGE_KEY = 'neko-theme';
const THEME_EVENT = 'neko-theme-change';

const readPreference = (): ThemePreference => {
  const saved = localStorage.getItem(STORAGE_KEY);
  return saved === 'light' || saved === 'dark' || saved === 'system' ? saved : 'system';
};

const applyTheme = (preference: ThemePreference) => {
  const dark = preference === 'dark' ||
    (preference === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches);
  const root = document.documentElement;
  root.classList.toggle('dark', dark);
  root.classList.toggle('theme-dark', dark);
  root.classList.toggle('theme-light', !dark);
  root.style.colorScheme = dark ? 'dark' : 'light';
};

const ThemeToggle: React.FC<{ compact?: boolean }> = ({ compact = false }) => {
  const [preference, setPreference] = useState<ThemePreference>(readPreference);

  useEffect(() => {
    applyTheme(preference);
    const media = window.matchMedia('(prefers-color-scheme: dark)');
    const onSystemChange = () => preference === 'system' && applyTheme('system');
    const onThemeEvent = (event: Event) => {
      const next = (event as CustomEvent<ThemePreference>).detail;
      if (next !== preference) setPreference(next);
    };
    media.addEventListener('change', onSystemChange);
    window.addEventListener(THEME_EVENT, onThemeEvent);
    return () => {
      media.removeEventListener('change', onSystemChange);
      window.removeEventListener(THEME_EVENT, onThemeEvent);
    };
  }, [preference]);

  const choose = (next: ThemePreference) => {
    localStorage.setItem(STORAGE_KEY, next);
    setPreference(next);
    applyTheme(next);
    window.dispatchEvent(new CustomEvent(THEME_EVENT, { detail: next }));
  };

  const options = [
    { value: 'light' as const, label: 'Light', icon: Sun },
    { value: 'dark' as const, label: 'Dark', icon: Moon },
    { value: 'system' as const, label: 'System', icon: Laptop },
  ];

  return (
    <div className={`theme-toggle ${compact ? 'theme-toggle-compact' : ''}`} role="group" aria-label="Appearance">
      {options.map(({ value, label, icon: Icon }) => (
        <button
          key={value}
          type="button"
          onClick={() => choose(value)}
          className={preference === value ? 'is-active' : ''}
          aria-pressed={preference === value}
          title={`${label} appearance`}
        >
          <Icon size={14} />
          {!compact && <span>{label}</span>}
        </button>
      ))}
    </div>
  );
};

export default ThemeToggle;
