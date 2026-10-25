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

The WYSIWYG editor (P2), the real explorer (P4), vertical tabs (P5) and workspaces (P6)
are not built yet. The Tauri shell lands in P9; until then the UI runs in a browser against
a dev-only filesystem middleware.

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
