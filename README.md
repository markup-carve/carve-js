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
