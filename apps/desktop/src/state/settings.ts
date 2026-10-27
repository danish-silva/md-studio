import { create } from 'zustand';
import { fsProvider } from '../fs';

const SETTINGS_FILE = 'settings.json';
const SAVE_DELAY_MS = 400;

export type ThemeChoice = 'system' | 'light' | 'dark';

export interface Template {
  id: string;
  name: string;
  body: string;
}

export interface Settings {
  theme: ThemeChoice;
  accent: string;
  editorFont: string;
  fontSize: number;

  /** Saves after a pause as well as on Ctrl+S. */
  autosave: boolean;
  autosaveDelayMs: number;

  /** Dims everything but the block being edited. */
  focusMode: boolean;
  /** Keeps the line being edited vertically centred. */
  typewriter: boolean;
  spellcheck: boolean;

  renderDiagrams: boolean;
  renderMath: boolean;

  templates: Template[];
}

export const DEFAULT_SETTINGS: Settings = {
  theme: 'system',
  accent: '#8b7bf7',
  editorFont: 'ui-sans-serif, system-ui, "Segoe UI", Roboto, sans-serif',
  fontSize: 15,
  autosave: false,
  autosaveDelayMs: 800,
  focusMode: false,
  typewriter: false,
  spellcheck: true,
  renderDiagrams: true,
  renderMath: true,
  templates: [
    {
      id: 'daily',
      name: 'Daily note',
      body: '# {{date}}\n\n## Done\n\n- \n\n## Next\n\n- \n',
    },
    {
      id: 'meeting',
      name: 'Meeting',
      body: '# Meeting — {{date}}\n\n**Present:** \n\n## Notes\n\n- \n\n## Actions\n\n- [ ] \n',
    },
  ],
};

export interface SettingsState extends Settings {
  loaded: boolean;
  load: () => Promise<void>;
  update: (changes: Partial<Settings>) => void;
  reset: () => void;
}

let saveTimer: ReturnType<typeof setTimeout> | null = null;

export const useSettings = create<SettingsState>((set, get) => ({
  ...DEFAULT_SETTINGS,
  loaded: false,

  load: async () => {
    const raw = await fsProvider.readConfig(SETTINGS_FILE).catch(() => null);
    set({ ...DEFAULT_SETTINGS, ...parseSettings(raw), loaded: true });
  },

  update: (changes) => {
    set(changes);
    scheduleSave(get);
  },

  reset: () => {
    set({ ...DEFAULT_SETTINGS });
    scheduleSave(get);
  },
}));

function scheduleSave(get: () => SettingsState): void {
  if (saveTimer !== null) clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    saveTimer = null;
    void fsProvider.writeConfig(SETTINGS_FILE, JSON.stringify(toSettings(get()), null, 2));
  }, SAVE_DELAY_MS);
}

function toSettings(state: SettingsState): Settings {
  const { loaded: _loaded, load: _load, update: _update, reset: _reset, ...settings } = state;
  return settings;
}

/**
 * Tolerant, like the workspace file: an unknown or malformed value falls back to the
 * default rather than leaving the app in a state nobody can use.
 */
export function parseSettings(raw: string | null): Partial<Settings> {
  if (raw === null) return {};

  try {
    const value: unknown = JSON.parse(raw);
    if (typeof value !== 'object' || value === null) return {};
    const record = value as Partial<Settings>;

    return {
      theme: isTheme(record.theme) ? record.theme : DEFAULT_SETTINGS.theme,
      accent: isHexColour(record.accent) ? record.accent : DEFAULT_SETTINGS.accent,
      editorFont:
        typeof record.editorFont === 'string' && record.editorFont.length > 0
          ? record.editorFont
          : DEFAULT_SETTINGS.editorFont,
      fontSize: clamp(record.fontSize, 11, 28, DEFAULT_SETTINGS.fontSize),
      autosave: record.autosave === true,
      autosaveDelayMs: clamp(record.autosaveDelayMs, 200, 10000, DEFAULT_SETTINGS.autosaveDelayMs),
      focusMode: record.focusMode === true,
      typewriter: record.typewriter === true,
      spellcheck: record.spellcheck !== false,
      renderDiagrams: record.renderDiagrams !== false,
      renderMath: record.renderMath !== false,
      templates: Array.isArray(record.templates)
        ? record.templates.filter(isTemplate)
        : DEFAULT_SETTINGS.templates,
    };
  } catch {
    return {};
  }
}

function isTheme(value: unknown): value is ThemeChoice {
  return value === 'system' || value === 'light' || value === 'dark';
}

function isHexColour(value: unknown): value is string {
  return typeof value === 'string' && /^#[0-9a-f]{6}$/i.test(value);
}

function isTemplate(value: unknown): value is Template {
  if (typeof value !== 'object' || value === null) return false;
  const template = value as Partial<Template>;
  return (
    typeof template.id === 'string' &&
    typeof template.name === 'string' &&
    typeof template.body === 'string'
  );
}

function clamp(value: unknown, low: number, high: number, fallback: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback;
  return Math.min(high, Math.max(low, value));
}

/** `{{date}}` and `{{time}}` are the only placeholders; anything else is left alone. */
export function expandTemplate(body: string): string {
  const now = new Date();
  const pad = (value: number) => String(value).padStart(2, '0');

  return body
    .replace(/\{\{date\}\}/g, `${String(now.getFullYear())}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`)
    .replace(/\{\{time\}\}/g, `${pad(now.getHours())}:${pad(now.getMinutes())}`);
}
