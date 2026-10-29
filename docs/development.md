# Development

Working on carve-js itself: the checkout and the source layout. Contributor
guidelines, the test commands and the other gates are in
[CONTRIBUTING.md](https://github.com/markup-carve/carve-js/blob/main/.github/CONTRIBUTING.md).

## Install and develop

```sh
git clone --recurse-submodules https://github.com/markup-carve/carve-js.git
cd carve-js
npm install
npm test
```

If you cloned without `--recurse-submodules`, run `git submodule update --init`
to fetch the spec corpus.

## Layout

```
carve-js/
├── src/                    Entry points and implementation modules
│   ├── ast.ts              Typed AST node definitions
│   ├── parse.ts            Linear-time block + inline parser
│   ├── render-html.ts      AST → canonical HTML renderer
│   ├── render-markdown.ts  AST → Markdown renderer
│   ├── render-plain.ts     AST → plain-text renderer
│   ├── render-ansi.ts      AST → ANSI-styled renderer
│   ├── djot-migrate.ts     Djot/Markdown collision warnings + autocorrect
│   ├── markdown-migrate.ts Markdown → Carve source transform
│   ├── ast/                AST JSON, patches, and sidecars
│   ├── parse/              Block, inline, list, and table parser modules
│   ├── import/             Djot, Markdown, and HTML import helpers
│   ├── extension/          Built-in extensions
│   ├── heading/            Heading IDs, numbers, and references
│   ├── render/             Renderer helpers
│   ├── source/             Source positions and errors
│   ├── table/              Table layout and spans
│   ├── cli.ts              `carve` binary (render, fmt, flatten, fix, lint, diff, merge, portability, trace, migrate)
│   └── index.ts            Public API
├── test/                   Vitest suites + the spec corpus runner
├── spec/                   git submodule → markup-carve/carve
├── package.json
└── tsconfig.json
```

## HTML import performance

See [HTML import measurements](html-import-performance.md) for the #2154
investigation and a script that measures parser input separately from timing.

---

[Back to the README](https://github.com/markup-carve/carve-js/blob/main/README.md)
