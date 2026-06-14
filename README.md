# carve-js

Reference TypeScript implementation of the [Carve](https://github.com/markup-carve/carve) markup language.

> **Status:** the parser, renderers, and migration tooling are implemented and pass the spec corpus. Not yet published to npm.

## What this is

- A linear-time parser for `.crv` source → typed AST
- Renderers to HTML (canonical), Markdown, plain text, and ANSI
- A test runner that validates output against the [shared corpus](https://github.com/markup-carve/carve/tree/main/tests/corpus)

The spec, EBNF grammar, and example pairs live in the upstream [`markup-carve/carve`](https://github.com/markup-carve/carve) repo, pulled in here as a git submodule under [`spec/`](./spec). The corpus at `spec/tests/corpus/` is the contract this implementation honors.

## Install and develop

```sh
git clone --recurse-submodules https://github.com/markup-carve/carve-js.git
cd carve-js
npm install
npm test
```

If you cloned without `--recurse-submodules`, run `git submodule update --init`
to fetch the spec corpus.

## Usage

```ts
import { carveToHtml } from '@markup-carve/carve'

carveToHtml('# Hello\n\nThis is /italic/ and *bold*.')
// <section id="hello">
//   <h1>Hello</h1>
//   <p>This is <em>italic</em> and <strong>bold</strong>.</p>
// </section>
```

The package exposes one-call converters per output format, plus the lower-level
`parse` / `resolve` / `render*` functions for inspecting or transforming the AST:

```ts
import {
  carveToHtml,
  carveToMarkdown,
  carveToPlainText,
  carveToAnsi,
  parse,
  resolve,
  renderHtml,
} from '@markup-carve/carve'

const doc = resolve(parse(source)) // typed Document AST
const html = renderHtml(doc)       // same as carveToHtml(source)
```

## CLI

The package installs a `carve` binary. Rendering is the default action — it
reads a file or stdin and writes the rendered output to stdout. HTML is the
default; pass a format flag for Markdown, plain text, or ANSI:

```bash
carve README.crv > README.html   # HTML (default)
carve --markdown README.crv      # Markdown
carve --plain README.crv         # plain text
carve --ansi README.crv          # ANSI-colored terminal text
echo '# Hello' | carve           # render from stdin
```

`--html` / `--markdown` (`--md`) / `--plain` (`--plain-text`) / `--ansi` select
the format (the explicit `render` subcommand also works: `carve render --ansi`).
Two more subcommands round out the tooling:

```bash
carve fix  file.crv   # auto-fix Djot/Markdown delimiter collisions
carve lint file.crv   # validate: collisions + silent-failure problems
carve --help
```

`carve lint` is a validator for problems that *parse* but render as the wrong
thing (so nothing throws): broken `</#id>` cross-references, duplicate heading
ids, unresolved reference links, missing/duplicate/unused footnotes, a trailing
`{…}` on a heading (literal text, not an attribute block), a legacy
`` ```raw FORMAT `` fence (use `` ```=FORMAT ``), and a line that opens like a
block (`:::`, `{#`) but parsed as plain text. It exits non-zero when it reports
anything, so it works as a CI gate. The same checks surface live in editors
through [carve-lsp](https://github.com/markup-carve/carve-lsp).

## Documentation

- [Extensions](./docs/extensions.md) - opt-in extensions (`tabNormalize`,
  `details`, `mermaid`, `wikilinks`, `externalLinks`, `headingPermalinks`,
  `tableOfContents`, `autolink`) and how to add your own syntax with
  parse-stage matchers.
- [Migration and linting](./docs/migration.md) - `markdownToCarve`,
  Djot collision warnings + `carve fix`, and `lintCarve` / `carve lint`.

Try Carve live in the [playground](https://markup-carve.github.io/carve/playground),
which runs this implementation in the browser.

## Layout

```
carve-js/
├── src/
│   ├── ast.ts              Typed AST node definitions
│   ├── parse.ts            Linear-time block + inline parser
│   ├── render-html.ts      AST → canonical HTML renderer
│   ├── render-markdown.ts  AST → Markdown renderer
│   ├── render-plain.ts     AST → plain-text renderer
│   ├── render-ansi.ts      AST → ANSI-styled renderer
│   ├── djot-migrate.ts     Djot/Markdown collision warnings + autocorrect
│   ├── markdown-migrate.ts Markdown → Carve source transform
│   ├── cli.ts              `carve` binary (render, fix, lint)
│   └── index.ts            Public API
├── test/                   Vitest suites + the spec corpus runner
├── spec/                   git submodule → markup-carve/carve
├── package.json
└── tsconfig.json
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
