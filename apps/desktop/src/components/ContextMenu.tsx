import { useEffect, useRef } from 'react';

export interface MenuItem {
  label: string;
  onSelect: () => void;
  danger?: boolean | undefined;
  disabled?: boolean | undefined;
}

export interface ContextMenuProps {
  x: number;
  y: number;
  items: MenuItem[];
  onClose: () => void;
}

export function ContextMenu({ x, y, items, onClose }: ContextMenuProps) {
  const menu = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    function onPointerDown(event: MouseEvent) {
      if (!menu.current?.contains(event.target as Node)) onClose();
    }
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') onClose();
    }

    document.addEventListener('mousedown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    window.addEventListener('blur', onClose);
    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('blur', onClose);
    };
  }, [onClose]);

  return (
    <div
      ref={menu}
      role="menu"
      // Kept inside the window even when the click lands near an edge.
      style={{ left: Math.min(x, window.innerWidth - 190), top: Math.min(y, window.innerHeight - 8 - items.length * 28) }}
      className="fixed z-50 min-w-44 rounded border border-[var(--app-border)] bg-[var(--app-panel)] py-1 shadow-xl"
    >
      {items.map((item) => (
        <button
          key={item.label}
          type="button"
          role="menuitem"
          disabled={item.disabled ?? false}
          onClick={() => {
            onClose();
            item.onSelect();
          }}
          className={[
            'block w-full px-3 py-1 text-left text-xs disabled:cursor-not-allowed disabled:opacity-40',
            item.danger ? 'text-red-300 hover:bg-red-500/15' : 'hover:bg-[var(--app-hover)]',
          ].join(' ')}
        >
          {item.label}
        </button>
      ))}
    </div>
  );
}
