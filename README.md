# carve-js

Reference TypeScript implementation of the [Carve](https://github.com/markup-carve/carve) markup language.

> **Status:** the parser, HTML renderer, and migration tooling are implemented and pass the spec corpus. Not yet published to npm (the package is still `private`).

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
│   ├── parse.ts          Linear-time block + inline parser
│   ├── render-html.ts    AST → canonical HTML renderer
│   ├── djot-migrate.ts   Djot/Markdown collision warnings + autocorrect
│   ├── markdown-migrate.ts  Markdown → Carve source transform
│   ├── cli.ts            `carve` binary (carve fix)
│   └── index.ts          Public API (parse, resolve, renderHtml, carveToHtml)
├── test/                 Vitest suites, including the spec/tests/corpus
│                         runner that asserts parse + render matches each
│                         paired .html exactly
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
under Carve — use [`djotMigrationWarnings`](./src/djot-migrate.ts), and to
rewrite those collisions in place use `applyMigrationFixes` (or the `carve fix`
CLI below):

```ts
import { applyMigrationFixes } from '@markup-carve/carve'

const { output, applied, skipped } = applyMigrationFixes('use _emphasis_ here')
// output  -> 'use /emphasis/ here'
// applied -> the warnings that were spliced in
// skipped -> overlapping collisions (e.g. **_x_**) left for manual review
```

## Command line

Installing the package provides a `carve` binary. Its one subcommand, `carve
fix`, wraps `applyMigrationFixes` to rewrite Djot/Markdown delimiter collisions
to their Carve equivalents.

```sh
carve fix < in.crv > out.crv     # stdin -> stdout (default)
carve fix --write doc.crv …      # rewrite files in place
carve fix --check doc.crv …      # report only; exit 1 if any would change (CI)
carve fix --stdout doc.crv       # print the fix for one file, don't modify it
```

With no files it reads stdin and writes the fixed result to stdout. Overlapping
collisions that cannot be auto-fixed (e.g. `**_x_**`, which is both strong and
emphasis) are reported on stderr for manual review. `--check` is a gate: it
exits non-zero when a file would change or has manual-review collisions, so it
drops into a pre-commit hook or CI step.

## Extensions

Extensions are plain objects passed via `{ extensions: [...] }`. Carve preserves
literal tabs in code content by default (djot/CommonMark-aligned). Add
`tabNormalize(width = 2)` to expand each tab to spaces on output — flat
replacement, code content only — for fixed-width output without CSS `tab-size`:

```ts
import { carveToHtml, tabNormalize } from '@markup-carve/carve'

carveToHtml(src)                                  // tabs preserved (default)
carveToHtml(src, { extensions: [tabNormalize()] }) // tabs -> 2 spaces
carveToHtml(src, { extensions: [tabNormalize(4)] })// tabs -> 4 spaces
```

## Roadmap

See the [reference-parser plan](https://github.com/markup-carve/carve#roadmap) in the spec repo.

| Phase | Scope | Status |
|-------|-------|--------|
| M0.5 | Scaffold, AST types, corpus runner | ✅ Done |
| M1   | Block parser: headings, paragraphs, lists, quotes, fences, tables, frontmatter, hr, admonitions, captions | ✅ Done |
| M2   | Inline parser: emphasis (all 8 forms), links, images, code, autolinks, attributes, extensions, mentions, tags, smart typography, CriticMarkup | ✅ Done |
| M3   | HTML renderer; full corpus green | ✅ Done |
| M4   | npm publish; playground page in the docs site | Playground shipped; npm publish pending |

## License

MIT.
