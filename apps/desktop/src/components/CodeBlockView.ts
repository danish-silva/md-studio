import type { Node as PmNode } from 'prosemirror-model';
import type { NodeView, ViewMutationRecord } from 'prosemirror-view';

export interface CodeBlockOptions {
  diagrams: boolean;
  math: boolean;
  dark: boolean;
}

const DIAGRAM_LANGUAGES = new Set(['mermaid']);
const MATH_LANGUAGES = new Set(['math', 'katex', 'latex', 'tex']);

const RENDER_DELAY_MS = 300;
let diagramCounter = 0;

/**
 * A fenced code block, with a rendered preview underneath for diagrams and maths.
 *
 * Rendering keys off the fence's language rather than new syntax, so the document model
 * does not change and the file still round-trips byte-for-byte. That is also why inline
 * `$…$` maths is not supported: it would mean teaching the parser a new construct, and
 * every file in the workspace would start parsing differently.
 */
export class CodeBlockView implements NodeView {
  readonly dom: HTMLElement;
  readonly contentDOM: HTMLElement;

  readonly #options: CodeBlockOptions;
  #preview: HTMLDivElement | null = null;
  #timer: ReturnType<typeof setTimeout> | null = null;
  #rendered = '';

  constructor(node: PmNode, options: CodeBlockOptions) {
    this.#options = options;

    this.dom = document.createElement('div');
    this.dom.className = 'md-code-block';

    const pre = document.createElement('pre');
    const code = document.createElement('code');
    pre.append(code);
    this.dom.append(pre);
    this.contentDOM = code;

    this.#sync(node);
  }

  update(node: PmNode): boolean {
    if (node.type.name !== 'codeBlock') return false;
    this.#sync(node);
    return true;
  }

  destroy(): void {
    if (this.#timer !== null) clearTimeout(this.#timer);
  }

  /** The preview is not editable, so ProseMirror must not try to read it as content. */
  ignoreMutation(mutation: ViewMutationRecord): boolean {
    return this.#preview !== null && this.#preview.contains(mutation.target);
  }

  #sync(node: PmNode): void {
    const language = typeof node.attrs['language'] === 'string' ? node.attrs['language'] : '';
    const kind = this.#kindOf(language);

    if (kind === null) {
      this.#preview?.remove();
      this.#preview = null;
      this.#rendered = '';
      return;
    }

    const source = node.textContent;
    if (source === this.#rendered && this.#preview !== null) return;

    if (this.#preview === null) {
      this.#preview = document.createElement('div');
      this.#preview.className = 'md-code-preview';
      this.#preview.contentEditable = 'false';
      this.dom.append(this.#preview);
    }

    if (this.#timer !== null) clearTimeout(this.#timer);
    this.#timer = setTimeout(() => {
      this.#timer = null;
      this.#rendered = source;
      void this.#render(kind, source);
    }, RENDER_DELAY_MS);
  }

  #kindOf(language: string): 'diagram' | 'math' | null {
    const key = language.toLowerCase();
    if (this.#options.diagrams && DIAGRAM_LANGUAGES.has(key)) return 'diagram';
    if (this.#options.math && MATH_LANGUAGES.has(key)) return 'math';
    return null;
  }

  async #render(kind: 'diagram' | 'math', source: string): Promise<void> {
    const target = this.#preview;
    if (!target) return;

    if (source.trim().length === 0) {
      target.textContent = '';
      return;
    }

    try {
      if (kind === 'math') {
        // Both libraries are heavy and most documents use neither, so they load on demand.
        const katex = await import('katex');
        target.innerHTML = katex.default.renderToString(source, {
          displayMode: true,
          throwOnError: true,
          output: 'html',
        });
        target.classList.remove('md-code-preview-error');
        return;
      }

      const mermaid = await import('mermaid');
      mermaid.default.initialize({
        startOnLoad: false,
        theme: this.#options.dark ? 'dark' : 'default',
      });

      diagramCounter += 1;
      const { svg } = await mermaid.default.render(`md-studio-diagram-${String(diagramCounter)}`, source);

      // Still the current source? A fast typist can outrun the render.
      if (this.#rendered !== source) return;
      target.innerHTML = svg;
      target.classList.remove('md-code-preview-error');
    } catch (error) {
      target.textContent = error instanceof Error ? error.message : String(error);
      target.classList.add('md-code-preview-error');
    }
  }
}
