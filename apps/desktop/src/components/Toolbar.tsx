import type { CommandName, EditorStatus } from '@md-studio/editor';
import type { ReactNode } from 'react';

export interface ToolbarProps {
  status: EditorStatus | null;
  onRun: (name: CommandName) => void;
  onLink: () => void;
}

interface ButtonProps {
  name: CommandName;
  label: string;
  // `| undefined` is explicit because exactOptionalPropertyTypes is on and these are fed
  // straight from an optional status object.
  shortcut?: string | undefined;
  active?: boolean | undefined;
  children: ReactNode;
  status: EditorStatus | null;
  onRun: (name: CommandName) => void;
  className?: string | undefined;
}

function Button({ name, label, shortcut, active, children, status, onRun, className }: ButtonProps) {
  const enabled = status?.can[name] ?? false;
  // A disabled button explains itself: markdown has no form for what it would do here.
  const reason = status?.reason[name];
  const title = reason ?? (shortcut ? `${label} (${shortcut})` : label);

  return (
    <button
      type="button"
      aria-label={label}
      aria-pressed={active ?? undefined}
      title={title}
      disabled={!enabled}
      onClick={() => onRun(name)}
      className={[
        'flex h-7 min-w-7 items-center justify-center rounded px-1.5 text-sm leading-none',
        'disabled:cursor-not-allowed disabled:opacity-30',
        active
          ? 'bg-[var(--app-accent-soft)] text-[var(--app-text)]'
          : 'hover:bg-[var(--app-hover)]',
        className ?? '',
      ].join(' ')}
    >
      {children}
    </button>
  );
}

function Separator() {
  return <span aria-hidden className="mx-1 h-5 w-px bg-[var(--app-border)]" />;
}

const BLOCK_OPTIONS = [
  { value: 'paragraph', label: 'Paragraph' },
  { value: 'heading1', label: 'Heading 1' },
  { value: 'heading2', label: 'Heading 2' },
  { value: 'heading3', label: 'Heading 3' },
  { value: 'heading4', label: 'Heading 4' },
  { value: 'heading5', label: 'Heading 5' },
  { value: 'heading6', label: 'Heading 6' },
  { value: 'codeBlock', label: 'Code block' },
] as const;

function currentBlockValue(status: EditorStatus | null): string {
  if (!status) return 'paragraph';
  if (status.block === 'codeBlock') return 'codeBlock';
  if (status.block === 'heading' && status.headingLevel !== null) {
    return `heading${String(status.headingLevel)}`;
  }
  return 'paragraph';
}

/**
 * Deliberately absent: underline, font size, font family, text colour and alignment.
 * Markdown has no syntax for them and the toolbar never emits HTML.
 */
export function Toolbar({ status, onRun, onLink }: ToolbarProps) {
  const blockValue = currentBlockValue(status);
  // A link needs something to attach to: selected text, or a link already under the caret.
  const linkEnabled = status !== null && (status.hasSelection || status.link !== null);

  return (
    <div
      role="toolbar"
      aria-label="Formatting"
      className="flex shrink-0 flex-wrap items-center gap-0.5 border-b border-[var(--app-border)] bg-[var(--app-panel)] px-2 py-1"
    >
      <select
        aria-label="Block style"
        value={blockValue}
        disabled={status === null}
        onChange={(event) => onRun(event.target.value as CommandName)}
        className="h-7 rounded border border-[var(--app-border)] bg-transparent px-1 text-xs"
      >
        {BLOCK_OPTIONS.map((option) => (
          <option key={option.value} value={option.value} disabled={!status?.can[option.value]}>
            {option.label}
          </option>
        ))}
      </select>

      <Separator />

      <Button name="bold" label="Bold" shortcut="Ctrl+B" active={status?.marks.bold} status={status} onRun={onRun} className="font-bold">
        B
      </Button>
      <Button name="italic" label="Italic" shortcut="Ctrl+I" active={status?.marks.italic} status={status} onRun={onRun} className="italic font-serif">
        I
      </Button>
      <Button name="strike" label="Strikethrough" shortcut="Ctrl+Shift+X" active={status?.marks.strike} status={status} onRun={onRun} className="line-through">
        S
      </Button>
      <Button name="code" label="Inline code" shortcut="Ctrl+Shift+C" active={status?.marks.code} status={status} onRun={onRun} className="font-mono text-xs">
        {'<>'}
      </Button>

      <Separator />

      <button
        type="button"
        aria-label="Link"
        aria-pressed={status?.marks.link ?? false}
        title="Link (Ctrl+K)"
        disabled={!linkEnabled}
        onClick={onLink}
        className={[
          'flex h-7 items-center justify-center rounded px-2 text-xs leading-none',
          'disabled:cursor-not-allowed disabled:opacity-30',
          status?.marks.link
            ? 'bg-[var(--app-accent-soft)] text-[var(--app-text)]'
            : 'hover:bg-[var(--app-hover)]',
        ].join(' ')}
      >
        Link
      </button>
      <Button name="removeLink" label="Remove link" status={status} onRun={onRun} className="text-xs">
        Unlink
      </Button>

      <Separator />

      <Button name="bulletList" label="Bullet list" shortcut="Ctrl+Shift+8" active={status?.list === 'bullet'} status={status} onRun={onRun}>
        •
      </Button>
      <Button name="orderedList" label="Numbered list" shortcut="Ctrl+Shift+7" active={status?.list === 'ordered'} status={status} onRun={onRun} className="text-xs">
        1.
      </Button>
      <Button name="taskList" label="Task list" shortcut="Ctrl+Shift+9" active={status?.list === 'task'} status={status} onRun={onRun}>
        ☑
      </Button>
      <Button name="outdent" label="Outdent" shortcut="Shift+Tab" status={status} onRun={onRun}>
        ⇤
      </Button>
      <Button name="indent" label="Indent" shortcut="Tab" status={status} onRun={onRun}>
        ⇥
      </Button>

      <Separator />

      <Button name="blockquote" label="Block quote" shortcut="Ctrl+Shift+." active={status?.inBlockquote} status={status} onRun={onRun}>
        ❝
      </Button>
      <Button name="table" label="Insert table" status={status} onRun={onRun}>
        ⊞
      </Button>
      <Button name="horizontalRule" label="Horizontal rule" status={status} onRun={onRun}>
        ―
      </Button>

      <Separator />

      <Button name="clearFormatting" label="Clear formatting" shortcut="Ctrl+Space" status={status} onRun={onRun} className="text-xs">
        Tx
      </Button>

      <span className="ml-auto flex items-center gap-0.5">
        <Button name="undo" label="Undo" shortcut="Ctrl+Z" status={status} onRun={onRun}>
          ↶
        </Button>
        <Button name="redo" label="Redo" shortcut="Ctrl+Y" status={status} onRun={onRun}>
          ↷
        </Button>
      </span>
    </div>
  );
}
