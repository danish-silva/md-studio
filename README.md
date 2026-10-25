# md-studio

A markdown viewer and editor with a Word-like formatting surface, a VS Code-style
multi-root explorer, Arc-style vertical tabs, and restorable workspaces.

Markdown text is always the source of truth. The toolbar emits no HTML — there are no
underline, colour, centring or font-size buttons, because markdown has no syntax for them.

See [docs/BUILD-PLAN.md](docs/BUILD-PLAN.md) for the full design and the phase sequence.

## Status

**P0 — scaffold.** The monorepo, the Vite UI, the development filesystem bridge, and
opening, editing and saving a single file in source mode, with external-change detection.

**P1 — markdown core.** `packages/markdown`: a pinned remark pipeline and a two-way bridge
between mdast and a ProseMirror document, guarded by a golden corpus that asserts files
come back byte-for-byte.

**P2 — the formatted editor.** `packages/editor`: a ProseMirror command layer, the
toolbar, the shortcut map, markdown input rules, task checkboxes, and a per-document
toggle between the formatted view and the markdown source.

**P3 — tables and incoming content.** Row and column tools, per-column alignment, a grid
picker, Tab between cells, HTML from Word and the web converted to markdown on paste,
spreadsheet cells pasted as a table, and images written into an `assets/` folder beside
the document.

**P4 — the explorer.** A multi-root folder tree with file operations (new, rename,
drag-move, move to recycle bin), a live filesystem watcher, and external changes reaching
the open document: a clean file reloads itself, a modified one warns instead, and a
deleted one offers to be written back.

**P5 — vertical tabs.** Several documents open at once, as an Arc-style vertical strip:
a pinned zone above everything, the rest grouped under the workspace folder they belong
to, drag to reorder, recently closed for one-click reopening, and auto-archiving of tabs
left untouched. Switching tabs keeps each document's undo history.

**P6 — workspaces and session restore.** Named workspaces remember their folders, open
tabs (with pin state, view mode, caret and scroll), the active tab, the sidebar and the
explorer's settings, and restore them on launch. Unsaved buffers are written separately as
drafts and offered back after a crash — or after switching workspaces and returning.

**P7 — finding things.** A command palette (`Ctrl+P` for files, `Ctrl+Shift+P` for
commands), find and replace in the document with regex and capture groups, search and
replace across every folder, an outline panel whose entries can be dragged to move whole
sections, and a problems panel for broken frontmatter, broken relative links and a small
set of lint rules.

The Tauri shell lands in P9; until then the UI runs in a browser against a dev-only
filesystem middleware, and workspaces live in `~/.md-studio-dev` (override with
`MD_STUDIO_DEV_CONFIG`).

### Known gaps

- Switching between formatted and source view resets undo history for that document.
  Switching *tabs* does not.
- Ctrl+Tab cycles tabs in the desktop build; a browser keeps that shortcut for itself, so
  Alt+Up and Alt+Down do the same thing.
- Window size and position are not persisted. That is Tauri's job and arrives with the
  shell in P9.
- Switching workspaces with unsaved changes does not prompt. The draft is kept, and
  coming back offers to restore it.
- A tab whose file has since been deleted is dropped during restore, with a note saying
  how many.
- The formatted view serialises the whole document to markdown on every keystroke. That is
  comfortably fast at the sizes tested, and incremental serialisation can wait until it
  is not.
- Pasted CSV is only recognised when nothing is quoted. Quoted CSV needs a real parser,
  and guessing would mangle the paste silently, so it is pasted as plain text instead.
- There is no header-row toggle, and the header row cannot be deleted: every GFM table
  has one.
- Images always go to `assets/` beside the document. The location is not configurable.
- The explorer filter narrows folders that are already open; it does not search the disk.
  The Search panel is the one that looks at every folder.
- Workspace search covers markdown files only, and both it and quick-open cap their
  results rather than paging.
- Replacing across folders writes to disk and skips any file with unsaved changes,
  reporting how many it skipped.
- Clicking a search result opens the file and hands the query to the in-document find, so
  the match is highlighted wherever the caret lands.
- Only one file is open at a time. Tabs arrive in P5.
- Adding a folder means typing or pasting its path, because a browser cannot offer a
  native folder picker. Tauri's dialog replaces that in P9.

### What a save changes

Parsing and writing a file back is byte-identical when it is already in the canonical
style. Otherwise the save normalises it — setext headings become ATX, `*` bullets become
`-`, `__strong__` becomes `**strong**`, table cells are padded to their column width.
`packages/markdown/test/fixtures/normalize` commits to exactly what those rewrites are.

Anything the editor cannot model — raw HTML, footnote definitions, link reference
definitions — is held verbatim and written back unchanged.

## Running it

```bash
npm install
npm run dev
```

Then open <http://localhost:5173>.

By default the app may only read and write inside the repository. Point it elsewhere with
a path-delimiter separated list:

```bash
MD_STUDIO_DEV_ROOTS="D:\\Notes;D:\\Projects" npm run dev
```

`samples/welcome.md` is a scratch document covering the markdown constructs the later
phases have to round-trip.

## Layout

| Path | Contains |
| --- | --- |
| `apps/desktop/src` | React UI: state, components, filesystem providers |
| `apps/desktop/dev` | Development-only filesystem middleware (replaced by Rust in P9) |
| `docs` | Build plan and decision records |
| `samples` | Scratch markdown documents |

## Scripts

| Command | Does |
| --- | --- |
| `npm run dev` | Vite dev server with the filesystem bridge |
| `npm run build` | Typecheck, then a production bundle |
| `npm run typecheck` | `tsc --noEmit` across every workspace |
