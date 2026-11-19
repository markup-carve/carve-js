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
to fetch the specification.

## Layout

```
carve-js/
├── src/                  The engine: block and inline parser, resolver, HTML renderer, writer
├── public/               The package entry points (`.` and `./node`) and their build
├── cli/                  The `carve` bin
├── lint/                 The linter
├── migrate/              Tree migration from AST 1.x and drafts
├── import/               HTML, Markdown, GFM and Djot import
├── upgrade/              `carve upgrade`, with the frozen 0.1 reader in upgrade/engine-0.1/
├── extensions/           Example extensions ported from 0.1, not shipped
├── data/                 Tables and the conformance corpus copied from the specification
├── test/                 Vitest suites
├── proptest/             Source property tests
├── scripts/              Generators, gates, benchmarks and the browser bundle build
└── spec/                 git submodule: markup-carve/carve
```

`npm run build` compiles the 0.1 reader into `build/engine-0.1/` (not published), then bundles
`dist/index.js`, `dist/node.js`, `dist/cli.js` and the declarations in `dist/types/`.
`npm run build:browser` writes `dist/carve.iife.min.js`.

---

[Back to the README](https://github.com/markup-carve/carve-js/blob/main/README.md)
