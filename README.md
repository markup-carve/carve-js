# carve-js

[![CI](https://github.com/markup-carve/carve-js/actions/workflows/ci.yml/badge.svg)](https://github.com/markup-carve/carve-js/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

Reference TypeScript implementation of the
[Carve](https://github.com/markup-carve/carve) markup language. It implements
Carve spec 0.1 and passes the shared specification corpus. Try it in the
[playground](https://markup-carve.github.io/carve/playground) and review the
[versioning contract](https://markup-carve.github.io/carve/versioning).

## Install

```bash
npm install @markup-carve/carve
```

Node 20 or newer.

## Render Carve

```ts
import { carveToHtml, carveToHtmlWithReport } from '@markup-carve/carve'

carveToHtml('# Hello\n\nThis is /italic/ and *bold*.')
```

The package also exports `carveToMarkdown`, `carveToPlainText`, and
`carveToAnsi`. Lower-level `parse`, `resolve`, and `render*` functions expose
the typed AST for inspection or transformation.

```ts
import { parse, renderHtml, resolve } from '@markup-carve/carve'

const document = resolve(parse(source))
const html = renderHtml(document)
```

Checked render functions report content omitted for the selected target and
can throw before publishing a value:

```ts
const result = carveToHtmlWithReport('`x`{=latex}')
carveToHtmlWithReport('`x`{=latex}', { strictLosses: true })
```

See the [full usage reference](https://github.com/markup-carve/carve-js/blob/main/docs/reference.md)
for checked output, custom renderers, symbols, profiles, and static output.

## Browser and CLI

The package works as an ES module, a browser bundle, or through the `carve`
CLI:

```bash
npx carve README.crv
npx carve lint README.crv
npx carve fmt -w README.crv
```

See [Browser use](https://github.com/markup-carve/carve-js/blob/main/docs/browser.md),
[Command line](https://github.com/markup-carve/carve-js/blob/main/docs/cli.md), and
[Integrations](https://github.com/markup-carve/carve-js/blob/main/docs/integrations.md).

## Migration and editing

HTML migration produces Carve with a structured fidelity report. Markdown,
Djot, and BBCode importers return Carve source. Source-preserving patches let
editors apply canonical formatting without replacing unrelated bytes.

- [Migration](https://github.com/markup-carve/carve-js/blob/main/docs/migration.md)
- [HTML import](https://github.com/markup-carve/carve-js/blob/main/docs/html-import.md)
- [Source-preserving patches](https://github.com/markup-carve/carve-js/blob/main/docs/source-patches.md)
- [Reversible patches](https://github.com/markup-carve/carve-js/blob/main/docs/reversible-patches.md)
- [AST sidecars](https://github.com/markup-carve/carve-js/blob/main/docs/ast-sidecars.md)

## Includes

The parser leaves `{{ path }}` literal. Hosts opt into `expandIncludes` and
supply a resolver, containment rules, and source identities. Included nodes
retain their source identity for diagnostics and dependency tracking.

The [complete API and include reference](https://github.com/markup-carve/carve-js/blob/main/docs/reference.md) covers
expansion, positioned warnings, resolver behavior, rendering parsed trees, and
editor integrations.

## Security

Raw HTML, custom renderers, symbols, and include resolvers cross different
trust boundaries. Use profiles and safe rendering for untrusted documents, and
do not treat symbol values or renderer output as escaped text. On the CLI use
`--safe`; in the library set `allowRawHtml: false` and choose a profile. See
[Security](https://github.com/markup-carve/carve-js/blob/main/docs/security.md).

## Documentation

The [`docs/`](https://github.com/markup-carve/carve-js/tree/main/docs) directory covers extensions, accessibility linting,
streaming, browser use, the CLI, migration, rendering, and integrations.

## Development

Start with [CONTRIBUTING.md](https://github.com/markup-carve/carve-js/blob/main/CONTRIBUTING.md)
for the toolchain, the test commands, and what a spec-affecting change involves.
The [development guide](https://github.com/markup-carve/carve-js/blob/main/docs/development.md)
has the source map.

### Whitespace and annotation offsets

An escaped space produces a `non_breaking_space` node. Preserved line-block
columns use the same node. Text and verbatim values keep literal Unicode,
including U+E000. HTML renders generated spaces as `&nbsp;`; Markdown uses
U+00A0, and plain text and ANSI use ordinary spaces. Package and envelope
versions remain on the existing release line.

Annotation offsets count Unicode codepoints in the contract's fixed field
order. They do not depend on JSON property insertion order or source positions.
The shared annotation fixture covers image alt text, math, breaks and reversed
ranges.
