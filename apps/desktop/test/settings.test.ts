import { describe, expect, it } from 'vitest';
import { mix } from '../src/lib/theme';
import { DEFAULT_SETTINGS, expandTemplate, parseSettings } from '../src/state/settings';

describe('parseSettings', () => {
  it('returns nothing for a missing file, so defaults apply', () => {
    expect(parseSettings(null)).toEqual({});
    expect(parseSettings('not json')).toEqual({});
  });

  it('keeps values it recognises', () => {
    const parsed = parseSettings(JSON.stringify({ theme: 'light', fontSize: 18, autosave: true }));
    expect(parsed).toMatchObject({ theme: 'light', fontSize: 18, autosave: true });
  });

  it('falls back on a value it does not recognise', () => {
    const parsed = parseSettings(JSON.stringify({ theme: 'neon', accent: 'blue' }));
    expect(parsed.theme).toBe(DEFAULT_SETTINGS.theme);
    expect(parsed.accent).toBe(DEFAULT_SETTINGS.accent);
  });

  it('clamps a font size that would make the editor unusable', () => {
    expect(parseSettings('{"fontSize":200}').fontSize).toBe(28);
    expect(parseSettings('{"fontSize":2}').fontSize).toBe(11);
  });

  it('treats the rendering toggles as on unless explicitly off', () => {
    expect(parseSettings('{}').renderDiagrams).toBe(true);
    expect(parseSettings('{"renderDiagrams":false}').renderDiagrams).toBe(false);
  });

  it('drops malformed templates but keeps the good ones', () => {
    const parsed = parseSettings(
      JSON.stringify({ templates: [{ id: 'a', name: 'A', body: 'x' }, { id: 'b' }, 'nope'] }),
    );
    expect(parsed.templates).toEqual([{ id: 'a', name: 'A', body: 'x' }]);
  });
});

describe('expandTemplate', () => {
  it('fills in the date placeholder', () => {
    const expanded = expandTemplate('# {{date}}\n');
    expect(expanded).toMatch(/^# \d{4}-\d{2}-\d{2}\n$/);
  });

  it('leaves unknown placeholders alone', () => {
    expect(expandTemplate('{{author}}')).toBe('{{author}}');
  });
});

describe('mix', () => {
  it('blends towards the background', () => {
    expect(mix('#ffffff', '#000000', 0.5)).toBe('#808080');
    expect(mix('#ffffff', '#000000', 0)).toBe('#000000');
    expect(mix('#ffffff', '#000000', 1)).toBe('#ffffff');
  });

  it('returns the colour unchanged when it cannot parse one', () => {
    expect(mix('rebeccapurple', '#000000', 0.5)).toBe('rebeccapurple');
  });
});
