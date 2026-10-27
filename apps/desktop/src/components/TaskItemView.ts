import type { Node as PmNode } from 'prosemirror-model';
import type { EditorView, NodeView } from 'prosemirror-view';

/**
 * Renders a list item, with a working checkbox when the item carries task state.
 *
 * The checkbox is a real input rather than a decoration so it behaves the way people
 * expect — clickable without first placing the caret, and not selectable as text.
 */
export class TaskItemView implements NodeView {
  readonly dom: HTMLLIElement;
  readonly contentDOM: HTMLElement;
  #checkbox: HTMLInputElement | null = null;

  constructor(node: PmNode, view: EditorView, getPos: () => number | undefined) {
    this.dom = document.createElement('li');
    this.contentDOM = document.createElement('div');
    this.contentDOM.className = 'md-item-body';

    const checked = node.attrs['checked'];
    if (typeof checked === 'boolean') {
      this.dom.className = 'md-task-item';

      const box = document.createElement('input');
      box.type = 'checkbox';
      box.checked = checked;
      box.className = 'md-task-checkbox';
      // Keep the click from moving the selection before the change lands.
      box.addEventListener('mousedown', (event) => event.preventDefault());
      box.addEventListener('change', () => {
        const pos = getPos();
        if (pos === undefined) return;
        view.dispatch(view.state.tr.setNodeAttribute(pos, 'checked', box.checked));
      });

      this.dom.append(box);
      this.#checkbox = box;
    }

    this.dom.append(this.contentDOM);
  }

  update(node: PmNode): boolean {
    if (node.type.name !== 'listItem') return false;

    const checked = node.attrs['checked'];
    const isTask = typeof checked === 'boolean';
    // Gaining or losing the checkbox changes the DOM shape; let ProseMirror rebuild.
    if (isTask !== (this.#checkbox !== null)) return false;

    if (this.#checkbox && typeof checked === 'boolean') {
      this.#checkbox.checked = checked;
    }
    return true;
  }

  stopEvent(event: Event): boolean {
    return this.#checkbox !== null && event.target === this.#checkbox;
  }
}
