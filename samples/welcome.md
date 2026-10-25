---
title: Welcome to md-studio
tags: [sample, p0]
---

# Welcome to md-studio

A scratch file for exercising the editor. Edit it, press <kbd>Ctrl+S</kbd>, and check the
bytes on disk.

## Inline formatting

This paragraph has **bold**, *italic*, ~~struck~~ and `inline code`, plus a
[link](https://commonmark.org) and a footnote reference.[^1]

[^1]: Footnotes are a GFM extension, handled by remark-gfm in P1.

## A table

| Phase | Deliverable          | Done |
| ----- | -------------------- | :--: |
| P0    | Scaffold, source mode|  ✓   |
| P1    | Markdown core        |      |
| P2    | WYSIWYG toolbar      |      |

## A list

- Bullet one
- Bullet two
  - Nested, to check indentation round-tripping
- [ ] An unchecked task
- [x] A checked task

## Code

```ts
export function hello(name: string): string {
  return `hello, ${name}`;
}
```

> A block quote, which P2 should be able to toggle from the toolbar.
