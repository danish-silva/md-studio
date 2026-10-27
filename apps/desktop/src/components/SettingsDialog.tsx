import { useState } from 'react';
import { DEFAULT_SETTINGS, useSettings, type Template } from '../state/settings';

const FONTS = [
  { label: 'System sans', value: 'ui-sans-serif, system-ui, "Segoe UI", Roboto, sans-serif' },
  { label: 'Serif', value: 'Georgia, "Times New Roman", serif' },
  { label: 'Monospace', value: 'ui-monospace, "Cascadia Code", Consolas, monospace' },
];

const ACCENTS = ['#8b7bf7', '#4c8dff', '#1fa97f', '#e0893a', '#d9566b', '#7a7a85'];

export function SettingsDialog({ onClose }: { onClose: () => void }) {
  const settings = useSettings();
  const [editing, setEditing] = useState<string | null>(null);

  const update = useSettings.getState().update;
  const template = settings.templates.find((entry) => entry.id === editing) ?? null;

  const saveTemplate = (next: Template) => {
    update({
      templates: settings.templates.map((entry) => (entry.id === next.id ? next : entry)),
    });
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center bg-black/40 pt-[8vh]"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        role="dialog"
        aria-label="Settings"
        className="flex max-h-[80vh] w-[min(46rem,94vw)] flex-col overflow-hidden rounded-lg border border-[var(--app-border)] bg-[var(--app-panel)] shadow-2xl"
      >
        <header className="flex shrink-0 items-center border-b border-[var(--app-border)] px-4 py-2.5">
          <h2 className="flex-1 text-sm font-medium">Settings</h2>
          <button
            type="button"
            onClick={() => useSettings.getState().reset()}
            className="rounded px-2 py-0.5 text-xs text-[var(--app-muted)] hover:bg-[var(--app-hover)]"
          >
            Reset to defaults
          </button>
          <button
            type="button"
            onClick={onClose}
            className="ml-1 rounded px-2 py-0.5 text-xs hover:bg-[var(--app-hover)]"
          >
            Done
          </button>
        </header>

        <div className="min-h-0 flex-1 space-y-5 overflow-y-auto p-4 text-xs">
          <Section title="Appearance">
            <Row label="Theme">
              <select
                value={settings.theme}
                onChange={(event) =>
                  update({ theme: event.target.value as typeof settings.theme })
                }
                className="rounded border border-[var(--app-border)] bg-transparent px-2 py-1"
              >
                <option value="system">Match the system</option>
                <option value="light">Light</option>
                <option value="dark">Dark</option>
              </select>
            </Row>

            <Row label="Accent">
              <span className="flex items-center gap-1.5">
                {ACCENTS.map((colour) => (
                  <button
                    key={colour}
                    type="button"
                    aria-label={colour}
                    onClick={() => update({ accent: colour })}
                    style={{ background: colour }}
                    className={[
                      'size-5 rounded-full border',
                      settings.accent.toLowerCase() === colour
                        ? 'border-[var(--app-text)]'
                        : 'border-transparent',
                    ].join(' ')}
                  />
                ))}
                <input
                  type="color"
                  aria-label="Custom accent"
                  value={settings.accent}
                  onChange={(event) => update({ accent: event.target.value })}
                  className="size-5 cursor-pointer border-0 bg-transparent p-0"
                />
              </span>
            </Row>

            <Row label="Editor font">
              <select
                value={settings.editorFont}
                onChange={(event) => update({ editorFont: event.target.value })}
                className="rounded border border-[var(--app-border)] bg-transparent px-2 py-1"
              >
                {FONTS.map((font) => (
                  <option key={font.label} value={font.value}>
                    {font.label}
                  </option>
                ))}
              </select>
            </Row>

            <Row label={`Font size (${String(settings.fontSize)}px)`}>
              <input
                type="range"
                min={11}
                max={24}
                value={settings.fontSize}
                onChange={(event) => update({ fontSize: Number(event.target.value) })}
              />
            </Row>
          </Section>

          <Section title="Editing">
            <Check
              label="Save automatically after a pause"
              checked={settings.autosave}
              onChange={(autosave) => update({ autosave })}
            />
            {settings.autosave && (
              <Row label={`Pause before saving (${String(settings.autosaveDelayMs)}ms)`}>
                <input
                  type="range"
                  min={300}
                  max={3000}
                  step={100}
                  value={settings.autosaveDelayMs}
                  onChange={(event) => update({ autosaveDelayMs: Number(event.target.value) })}
                />
              </Row>
            )}
            <Check
              label="Focus mode — dim everything but the paragraph being edited"
              checked={settings.focusMode}
              onChange={(focusMode) => update({ focusMode })}
            />
            <Check
              label="Typewriter mode — keep the current line centred"
              checked={settings.typewriter}
              onChange={(typewriter) => update({ typewriter })}
            />
            <Check
              label="Check spelling"
              checked={settings.spellcheck}
              onChange={(spellcheck) => update({ spellcheck })}
            />
          </Section>

          <Section title="Rendering">
            <Check
              label="Render ```mermaid blocks as diagrams"
              checked={settings.renderDiagrams}
              onChange={(renderDiagrams) => update({ renderDiagrams })}
            />
            <Check
              label="Render ```math blocks with KaTeX"
              checked={settings.renderMath}
              onChange={(renderMath) => update({ renderMath })}
            />
            <p className="text-[var(--app-muted)]">
              Both read the fence language, so documents stay plain markdown and round-trip
              unchanged. Inline <code>$…$</code> maths is not parsed.
            </p>
          </Section>

          <Section title="Templates">
            <p className="text-[var(--app-muted)]">
              Insert one from the command palette. <code>{'{{date}}'}</code> and{' '}
              <code>{'{{time}}'}</code> are filled in.
            </p>

            <div className="flex flex-wrap gap-1">
              {settings.templates.map((entry) => (
                <button
                  key={entry.id}
                  type="button"
                  onClick={() => setEditing(entry.id === editing ? null : entry.id)}
                  className={[
                    'rounded border px-2 py-0.5',
                    entry.id === editing
                      ? 'border-[var(--app-accent)] bg-[var(--app-accent-soft)]'
                      : 'border-[var(--app-border)] hover:bg-[var(--app-hover)]',
                  ].join(' ')}
                >
                  {entry.name}
                </button>
              ))}
              <button
                type="button"
                onClick={() => {
                  const id = `t${String(Date.now())}`;
                  update({
                    templates: [...settings.templates, { id, name: 'New template', body: '' }],
                  });
                  setEditing(id);
                }}
                className="rounded border border-dashed border-[var(--app-border)] px-2 py-0.5 text-[var(--app-muted)] hover:bg-[var(--app-hover)]"
              >
                + Add
              </button>
            </div>

            {template && (
              <div className="space-y-1.5 rounded border border-[var(--app-border)] p-2">
                <span className="flex gap-1">
                  <input
                    value={template.name}
                    aria-label="Template name"
                    onChange={(event) => saveTemplate({ ...template, name: event.target.value })}
                    className="min-w-0 flex-1 rounded border border-[var(--app-border)] bg-transparent px-2 py-1"
                  />
                  <button
                    type="button"
                    onClick={() => {
                      setEditing(null);
                      update({
                        templates: settings.templates.filter((entry) => entry.id !== template.id),
                      });
                    }}
                    className="rounded border border-red-500/50 px-2 py-0.5 text-red-300 hover:bg-red-500/20"
                  >
                    Delete
                  </button>
                </span>
                <textarea
                  value={template.body}
                  aria-label="Template body"
                  rows={8}
                  onChange={(event) => saveTemplate({ ...template, body: event.target.value })}
                  className="w-full rounded border border-[var(--app-border)] bg-transparent p-2 font-mono text-[11px] outline-none focus:border-[var(--app-accent)]"
                />
              </div>
            )}
          </Section>

          <p className="text-[var(--app-muted)]">
            Settings apply to every workspace and are stored alongside them. Defaults:{' '}
            {DEFAULT_SETTINGS.theme} theme, {String(DEFAULT_SETTINGS.fontSize)}px.
          </p>
        </div>
      </div>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="space-y-2">
      <h3 className="text-[11px] font-medium uppercase tracking-wider text-[var(--app-muted)]">
        {title}
      </h3>
      {children}
    </section>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-3">
      <span className="w-48 shrink-0">{label}</span>
      {children}
    </div>
  );
}

function Check({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (value: boolean) => void;
}) {
  return (
    <label className="flex items-center gap-2">
      <input type="checkbox" checked={checked} onChange={(event) => onChange(event.target.checked)} />
      <span>{label}</span>
    </label>
  );
}
