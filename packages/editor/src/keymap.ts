import { baseKeymap, chainCommands, createParagraphNear, liftEmptyBlock, newlineInCode, splitBlock } from 'prosemirror-commands';
import { undoInputRule } from 'prosemirror-inputrules';
import { keymap } from 'prosemirror-keymap';
import type { Command, Plugin } from 'prosemirror-state';
import { commands, splitListItemCommand } from './commands.ts';

export interface KeymapOptions {
  /** Ctrl+K needs a URL, which only the UI can ask for. */
  onRequestLink?: () => void;
}

/**
 * Word's conventions win wherever they collide with VS Code's — Ctrl+B is Bold, so the
 * sidebar toggle lives on Ctrl+\ and is bound at the window, not here.
 *
 * Returned as a single plugin so the app can put its own keymap at a higher precedence
 * later without reaching into this one.
 */
export function editorKeymap(options: KeymapOptions = {}): Plugin {
  const bindings: Record<string, Command> = {
    'Mod-b': commands.bold,
    'Mod-i': commands.italic,
    'Mod-Shift-x': commands.strike,
    'Mod-Shift-c': commands.code,

    'Mod-Alt-0': commands.paragraph,
    'Mod-Alt-1': commands.heading1,
    'Mod-Alt-2': commands.heading2,
    'Mod-Alt-3': commands.heading3,
    'Mod-Alt-4': commands.heading4,
    'Mod-Alt-5': commands.heading5,
    'Mod-Alt-6': commands.heading6,

    'Mod-Shift-8': commands.bulletList,
    'Mod-Shift-7': commands.orderedList,
    'Mod-Shift-9': commands.taskList,
    'Mod-Shift-.': commands.blockquote,

    'Mod- ': commands.clearFormatting,
    'Mod-Space': commands.clearFormatting,

    Tab: commands.indent,
    'Shift-Tab': commands.outdent,

    'Shift-Enter': commands.hardBreak,
    'Mod-Enter': commands.hardBreak,

    // Enter splits a list item before falling back to the generic block split.
    Enter: chainCommands(
      newlineInCode,
      splitListItemCommand,
      createParagraphNear,
      liftEmptyBlock,
      splitBlock,
    ),

    Backspace: chainCommands(undoInputRule, baseKeymap['Backspace'] ?? (() => false)),

    'Mod-z': commands.undo,
    'Mod-y': commands.redo,
    'Mod-Shift-z': commands.redo,
    'Shift-Mod-z': commands.redo,
  };

  if (options.onRequestLink) {
    const request = options.onRequestLink;
    bindings['Mod-k'] = () => {
      request();
      return true;
    };
  }

  return keymap(bindings);
}

export { undoInputRule };
