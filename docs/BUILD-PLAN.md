# md-studio — build plan

A desktop markdown viewer/editor with a Word-like formatting surface, a VS Code-style
multi-root explorer, Arc-style vertical tabs, and restorable workspaces. Markdown text is
always the source of truth; nothing is stored in a proprietary format.

Status: P0 (scaffold), P1 (markdown core), P2 (WYSIWYG editor), P3 (tables and paste),
P4 (explorer and watcher), P5 (vertical tabs), P6 (workspaces and restore), P7 (palette,
search, outline, problems), P8 (settings, themes, rendering) and P9 (the Tauri shell)
P10 (history, git, export) and P11 (packaging) complete. Every phase in this plan has
shipped.

## 1. Locked decisions

| Decision | Choice | Why |
|---|---|---|
| Shell | **Tauri v2** desktop app | Native file access without a server, small binary, WebView2 already present on this machine |
| UI | React 19 + TypeScript + Vite | Hot reload, mature ProseMirror/CodeMirror ecosystem |
| Document model | Markdown text, via `unified`/`remark` | Round-trippable, diff-friendly, portable |
| Editing surface | WYSIWYG primary (ProseMirror), per-tab source mode (CodeMirror 6) | Word-like by default, with an escape hatch for anything the visual schema can't express |
| Non-markdown formatting | **Omitted.** No underline, text colour, centring or font-size buttons | Output stays 100% pure markdown; no raw HTML is ever emitted by the toolbar |
| Wiki-links `[[note]]` | **Not implemented** | Non-standard; would break portability |
| Repo | `D:\Projects\md-studio`, remote `danish-silva/md-studio` | Existing |

### Toolchain

Satisfied as of P9: Rust 1.99.1 (`stable-x86_64-pc-windows-msvc`), Visual Studio Build
Tools 2022, and WebView2. The browser path remains supported and is the faster way to
work on the UI.

## 2. Markdown core (`packages/markdown`)

The most important package in the project. Everything else is UI on top of it.

```
file.md
  → remark-parse + remark-gfm + remark-frontmatter   → mdast
  → mdast → ProseMirror doc                          (bridge, this package)
      ↑ user edits ↓
  → ProseMirror doc → mdast                          (bridge, this package)
  → remark-stringify (pinned options)                → file.md
```

- **GFM** supplies tables, task lists, strikethrough and autolinks. Frontmatter is YAML.
- **Pinned stringify options** so output is deterministic and produces clean git diffs:
  `-` bullets, `*emphasis*`, `**strong**`, fenced code with backticks, ATX headings,
  reference-free links, fixed table cell padding.
- **Raw nodes.** Anything the visual schema cannot represent (existing raw HTML in a file,
  unknown directives, exotic footnote shapes) is parsed into a protected node that renders
  verbatim in WYSIWYG and serializes **byte-for-byte unchanged**. This is the mechanism
  that makes WYSIWYG safe on files we didn't write.
- **Golden round-trip tests.** A corpus of deliberately awkward markdown files, asserting
  `parse → stringify` is byte-identical, plus `parse → PM doc → mdast → stringify`
  equivalence. Runs in CI from P1 onward and gates every later phase.
- **Editor choice: plain ProseMirror, not TipTap.** The plan originally named TipTap v3.
  By P2 the schema already existed here and the bridge was written against it, while
  TipTap derives its own schema from extensions — and models two of our nodes differently
  (`listItem.checked`, and table alignment, which GFM puts on the table rather than the
  cells). Reconciling two schemas would have cost more than it saved. `prosemirror-commands`,
  `-schema-list`, `-inputrules` and `-history` give the same capability against the schema
  we have, with no adapter layer.

## 3. Filesystem layer

One `FileSystemProvider` interface, two implementations:

- **`TauriProvider`** (shipping) — Rust commands over Tauri IPC:
  `list_dir`, `read_file`, `write_file_atomic`, `stat`, `create`, `rename`, `move`,
  `trash`, `search`. Watching via the `notify` crate, streamed to the UI as events.
  Deleting goes to the Recycle Bin, never an unlink. Writes are atomic (temp file +
  rename) so a crash mid-save can't truncate a document.
- **`DevHttpProvider`** (development only) — a ~100-line Vite dev middleware exposing the
  same surface over HTTP, so the UI can be built and debugged in Chrome DevTools before
  the Rust toolchain exists and whenever hot reload is more convenient than the webview.

**Tauri v2 permission scopes.** The fs plugin is scoped, and workspace roots are chosen at
runtime, so adding a folder calls `FsExt::allow_directory` and the grant is persisted with
the workspace. No blanket filesystem access.

**External change detection.** `stat` mtime + size are captured on open and re-checked
before every save. On mismatch: "this file changed on disk" with keep-mine / reload / diff.
The watcher also live-reloads unmodified open files.

## 4. Formatting UI

**Toolbar**, sticky and grouped:

1. Block style dropdown — Paragraph, Heading 1–6, Quote, Code block
2. Bold, Italic, Strikethrough, Inline code, Highlight (`==`)
3. Link, Image
4. Bullet list, Numbered list, Task list, Indent, Outdent
5. Table (grid picker), Blockquote, Horizontal rule, Footnote
6. Clear formatting, Undo, Redo

Deliberately absent: underline, font size, font family, text colour, alignment — markdown
has no syntax for them and we are not emitting HTML.

**Floating bubble toolbar** on selection. **Slash menu** (`/table`, `/h2`, `/code`,
`/image`). **Input rules** so typing still works: `## ` → H2, `- ` → bullet, `1. ` →
ordered, `> ` → quote, triple-backtick → code fence, `**x**` → bold, `---` → rule.

**Tables** get first-class treatment: grid picker to insert, row and column tools,
per-column alignment buttons mapping to `:---` / `:--:` / `---:`, Tab to advance cells,
CSV/TSV paste converted to a table, and automatic escaping of `|` inside cell text.

Built against our own schema rather than `prosemirror-tables`, which requires
`colspan`/`rowspan`/`colwidth` attributes on cells and ships merge commands. GFM has no
merged cells, so adopting that model would let the editor represent documents markdown
cannot express — the failure this project exists to prevent. A GFM table is a plain
rectangle with a mandatory header row and one alignment per column, so it is implemented
directly.

For the same reason there is **no header-row toggle**, which an earlier draft of this plan
listed: every GFM table has a header row, so the first row always is one and cannot be
deleted.

**Paste and drop.** HTML pasted from Word or a browser is converted via `rehype-remark`
into clean markdown. A pasted or dropped image is written into an `assets/` folder beside
the document and linked relatively.

## 5. Keyboard shortcuts

All bindings live in a remappable JSON map. Word conventions win over VS Code where they
collide — notably `Ctrl+B` is Bold, so the sidebar toggle moves to `Ctrl+\`.

| Action | Shortcut |
|---|---|
| Bold / Italic / Strikethrough | `Ctrl+B` / `Ctrl+I` / `Ctrl+Shift+X` |
| Heading 1–6 | `Ctrl+Alt+1` … `Ctrl+Alt+6` |
| Bullet / numbered / task list | `Ctrl+Shift+8` / `Ctrl+Shift+7` / `Ctrl+Shift+9` |
| Link / inline code | `Ctrl+K` / `Ctrl+Shift+C` |
| Clear formatting | `Ctrl+Space` |
| Save / save all | `Ctrl+S` / `Ctrl+Shift+S` |
| Quick open file / command palette | `Ctrl+P` / `Ctrl+Shift+P` |
| Find / replace / workspace search | `Ctrl+F` / `Ctrl+H` / `Ctrl+Shift+F` |
| New / close / cycle tab | `Ctrl+N` / `Ctrl+W` / `Ctrl+Tab` |
| Toggle source mode | `Ctrl+Shift+M` |
| Toggle sidebar / focus explorer | `Ctrl+\` / `Ctrl+Shift+E` |

## 6. Sidebar

Resizable, collapsible left rail with stacked sections:

- **Open tabs — vertical, Arc-style.** The primary navigation. The active file is a filled
  rounded pill with an accent bar; modified files carry a dot; hover reveals close; drag to
  reorder. A **pinned zone** at the top survives closing. Tabs are **grouped under their
  root folder**, Arc's "spaces" mapped onto workspace roots. A dimmed **recently closed**
  group sits underneath for one-click reopen. Stale tabs can auto-archive after N days.
- **Folders.** Multi-root tree: add/remove root, new file/folder, rename, drag-move,
  delete to Recycle Bin, filter box, markdown-only and show-hidden toggles, live updates
  from the watcher, virtualized so a 10k-file folder stays smooth. Git status badges when
  a root is a repo.
- **Outline.** Headings of the current document, clickable, with drag-to-reorder sections.
- **Search.** Workspace-wide find and replace, results as a tree.
- **Problems.** Lint and link-integrity findings, non-blocking.

## 7. Workspaces and session restore

A named workspace file records:

- Root folder paths and their persisted fs permission grants
- Open tabs: path, order, pin state, group, editor mode, cursor offset, scroll position
- Active tab, sidebar width and collapse state, expanded tree nodes, recent files
- Per-workspace settings overrides

Written debounced on change and on window close; restored on launch. Multiple named
workspaces with a switcher and Open Recent. Window size/position/monitor persist via
`tauri-plugin-window-state`. Unsaved buffers are cached separately from the workspace file,
so a crash offers draft recovery on next launch.

**Save behaviour:** debounced autosave (~800ms idle) *and* explicit `Ctrl+S`, with
autosave toggleable in settings. Version snapshots (§9) make autosave safe to leave on.

## 8. Validation — what the "invalid markdown" popup actually is

CommonMark/GFM has no illegal input: any byte sequence parses. So there is no general
"invalid markdown" error to raise, and the popup is replaced by four narrower mechanisms:

1. **Impossible actions are disabled, not rejected.** A table inside a table cell, a
   heading inside a cell, block content where only inline is allowed — the button greys
   out with a tooltip explaining why. A toast appears only if forced via keyboard. By
   construction this means the user rarely sees an error at all.
2. **YAML frontmatter parse errors** — the one genuine parse failure. Inline marker in the
   editor, and a blocking modal if you try to save broken frontmatter.
3. **Broken relative links and images** — target missing on disk, flagged with a badge and
   a click-to-fix action.
4. **`remark-lint`** — configurable, non-blocking, surfaced in the Problems panel: ragged
   tables, duplicate headings, inconsistent list indentation, hard tabs.

## 9. Agreed feature set

Confirmed in: command palette; find & replace with regex; workspace-wide search and
replace; export to HTML/PDF/.docx; local version history with timeline and restore; git
integration (status badges, stage, commit); frontmatter form editor; Mermaid and KaTeX
live rendering; focus/typewriter mode with word count, reading time and spellcheck; split
editor; templates and snippets; Arc-style tab auto-archive; themes (light/dark/system,
accent colour, editor font).

Declined: wiki-links and backlinks.

Implementation notes on the heavier ones:

- **Version history** — content-addressed snapshots (sha256) in the app data dir with a
  per-file index and a retention policy. Independent of git, so it works in non-repo
  folders.
- **Git** — shells out to the `git` CLI (2.53 present) rather than linking `git2`. Status
  badges in the tree, stage/unstage, commit, branch display. No merge UI.
- **Export** — HTML via `rehype`; PDF via the webview's print pipeline; `.docx` generated
  from mdast with the `docx` library, with optional Pandoc passthrough when installed.
- **Spellcheck** — WebView2's native contenteditable spellcheck, no extra dependency.

## 10. Repository layout

```
md-studio/
├─ apps/desktop/          Tauri app
│  ├─ src/                React UI
│  └─ src-tauri/          Rust: fs commands, watcher, search, trash, git
├─ packages/markdown/     unified pipeline, mdast↔PM bridge, serializer, golden corpus
├─ packages/editor/       TipTap schema, commands, toolbar, input rules, table tools
├─ packages/ui/           primitives, theming tokens
└─ docs/                  this plan, ADRs
```

npm workspaces. Zustand for state. Tailwind for styling with CSS-variable theme tokens.
Vitest for unit and round-trip tests; Playwright (via the dev HTTP provider) for toolbar,
shortcut and tab behaviour.

## 11. Phases

Each phase ends in a working, committed, demonstrable state.

| Phase | Deliverable |
|---|---|
| **P0** | Monorepo scaffold, Vite UI, dev fs provider, open/edit/save a single file in source mode |
| **P1** | `packages/markdown` with the mdast bridge and the golden round-trip corpus in CI |
| **P2** | WYSIWYG editor, toolbar, shortcut map, input rules, source-mode toggle |
| **P3** | Tables, paste conversion from Word/HTML, image paste and drop into `assets/` |
| **P4** | Multi-root explorer, file operations, watcher, external-change conflict handling |
| **P5** | Arc vertical tabs: pins, reorder, root grouping, recently closed, auto-archive |
| **P6** | Workspaces, session restore, window state, draft recovery |
| **P7** | Command palette, find/replace, workspace search and replace, outline, Problems panel |
| **P8** | Settings, themes, focus mode, split editor, templates, frontmatter form, Mermaid/KaTeX |
| **P9** | Tauri shell made real: Rust fs commands, scoped permissions, native watcher and search |
| **P10** | Version history, git integration, export (HTML/PDF/docx) |
| **P11** | Packaging: MSI/NSIS installer, icons, updater, release workflow |

If the Rust toolchain is installed before P1, P9 moves up to P1 and the dev provider stays
only as a test harness.

## 12. Risks

1. **WYSIWYG ↔ markdown fidelity** — the central risk. Mitigated by raw nodes, per-tab
   source mode, and the golden corpus gating CI.
2. **Table editing** — ProseMirror tables plus GFM alignment and escaping is the fiddliest
   part of P3. Budget accordingly.
3. **Tauri toolchain weight** — several GB of MSVC build tools; sequenced around via the
   dev provider.
4. **Word-expectation gap** — with underline, colour and centring deliberately absent,
   some Word habits won't transfer. Tooltips should say "markdown has no underline"
   rather than leaving the absence unexplained.
5. **Large folders** — virtualization and incremental watching are required, not optional,
   for folders with thousands of files.
