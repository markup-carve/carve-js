# carve-js

Reference TypeScript implementation of the [Carve](https://github.com/markup-carve/carve) markup language.

> **Status:** scaffold. AST types and the test corpus runner are in place; the parser and HTML renderer are not yet implemented.

## What this is

- A linear-time parser for `.crv` source → typed AST
- An HTML renderer that produces the canonical output defined by the spec
- A test runner that validates output against the [shared corpus](https://github.com/markup-carve/carve/tree/master/tests/corpus)

The spec, EBNF grammar, and example pairs live in the upstream [`markup-carve/carve`](https://github.com/markup-carve/carve) repo, pulled in here as a git submodule under [`spec/`](./spec). The corpus at `spec/tests/corpus/` is the contract this implementation honors.

## Layout

```
carve-js/
├── src/
│   ├── ast.ts            Typed AST node definitions
│   └── index.ts          Public API (parse, render)
├── test/
│   └── corpus.test.ts    Runs every spec/tests/corpus/*.crv through
│                         parse + render and asserts the result matches
│                         the paired .html exactly
├── spec/                 git submodule → markup-carve/carve
├── package.json
└── tsconfig.json
```

## Development

```sh
git clone --recurse-submodules https://github.com/markup-carve/carve-js.git
cd carve-js
npm install
npm test
```

If you cloned without `--recurse-submodules`:

```sh
git submodule update --init
```

## Migrating from Markdown

`markdownToCarve(md)` rewrites common Markdown into equivalent Carve. It is a
source-to-source transform, not a parser, so it works on raw text and leaves
fenced/inline code untouched.

```ts
import { markdownToCarve } from '@markup-carve/carve'

markdownToCarve('a *very* **bold** ~~old~~ idea')
// => 'a /very/ *bold* ~old~ idea'
```

It handles the inline constructs that differ between Markdown and Carve, plus
Carve's blank-line-around-blocks rule:

| Markdown                | Carve     | Note                                      |
| ----------------------- | --------- | ----------------------------------------- |
| `*x*`, `_x_`            | `/x/`     | `_x_` is **underline** in Carve, not em   |
| `**x**`, `__x__`        | `*x*`     | Carve strong is a single `*`              |
| `***x***`, `___x___`    | `/*x*/`   | Carve's canonical bold-italic             |
| `~~x~~`                 | `~x~`     | Carve strikethrough is a single `~`       |
| `==x==`, `^x^`          | unchanged | identical in Carve                        |
| `$x$`                   | `` $`x` `` | inline math (`$5` left as currency)      |
| `<em>`/`<strong>`/`<mark>`/… | Carve form | common inline HTML tags             |

To go the other way — flagging a Djot document that would silently mis-render
under Carve — use [`djotMigrationWarnings`](./src/djot-migrate.ts).

## Roadmap

See the [reference-parser plan](https://github.com/markup-carve/carve#roadmap) in the spec repo.

| Phase | Scope |
|-------|-------|
| M0.5 | Scaffold, AST types, corpus runner (this commit) |
| M1   | Block parser: headings, paragraphs, lists, quotes, fences, tables, frontmatter, hr, admonitions, captions |
| M2   | Inline parser: emphasis (all 8 forms), links, images, code, autolinks, attributes, extensions, mentions, tags, smart typography, CriticMarkup |
| M3   | HTML renderer; full corpus green |
| M4   | npm publish; playground page in the docs site |

## License

MIT.
