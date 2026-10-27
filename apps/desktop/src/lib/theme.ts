import type { Settings, ThemeChoice } from '../state/settings';

export type EffectiveTheme = 'light' | 'dark';

interface Palette {
  bg: string;
  panel: string;
  border: string;
  hover: string;
  text: string;
  muted: string;
}

const PALETTES: Record<EffectiveTheme, Palette> = {
  dark: {
    bg: '#16161a',
    panel: '#1b1b21',
    border: '#2a2a32',
    hover: '#24242c',
    text: '#e6e6ea',
    muted: '#9a9aa4',
  },
  light: {
    bg: '#ffffff',
    panel: '#f7f7f9',
    border: '#e4e4ea',
    hover: '#eeeef3',
    text: '#1b1b22',
    muted: '#64646f',
  },
};

export function effectiveTheme(choice: ThemeChoice): EffectiveTheme {
  if (choice !== 'system') return choice;
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

/**
 * Themes are applied as CSS variables rather than class names, because the accent is a
 * free-form colour: everything derived from it has to be computed, not enumerated.
 */
export function applyTheme(settings: Settings): EffectiveTheme {
  const theme = effectiveTheme(settings.theme);
  const palette = PALETTES[theme];
  const root = document.documentElement;

  root.style.setProperty('--app-bg', palette.bg);
  root.style.setProperty('--app-panel', palette.panel);
  root.style.setProperty('--app-border', palette.border);
  root.style.setProperty('--app-hover', palette.hover);
  root.style.setProperty('--app-text', palette.text);
  root.style.setProperty('--app-muted', palette.muted);

  root.style.setProperty('--app-accent', settings.accent);
  root.style.setProperty('--app-accent-soft', mix(settings.accent, palette.bg, 0.2));
  root.style.setProperty('--app-font', settings.editorFont);
  root.style.setProperty('--app-font-size', `${String(settings.fontSize)}px`);

  root.style.colorScheme = theme;
  root.dataset['theme'] = theme;
  return theme;
}

/** `amount` of `colour` over `onto`, so the soft accent works on either background. */
export function mix(colour: string, onto: string, amount: number): string {
  const a = parseHex(colour);
  const b = parseHex(onto);
  if (!a || !b) return colour;

  const channel = (index: number) =>
    Math.round((a[index] ?? 0) * amount + (b[index] ?? 0) * (1 - amount));

  return `#${[channel(0), channel(1), channel(2)]
    .map((value) => value.toString(16).padStart(2, '0'))
    .join('')}`;
}

function parseHex(colour: string): [number, number, number] | null {
  const match = /^#([0-9a-f]{6})$/i.exec(colour.trim());
  if (!match?.[1]) return null;

  const value = Number.parseInt(match[1], 16);
  return [(value >> 16) & 255, (value >> 8) & 255, value & 255];
}
