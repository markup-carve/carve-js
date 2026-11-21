# carve-js

[![CI](https://github.com/markup-carve/carve-js/actions/workflows/ci.yml/badge.svg)](https://github.com/markup-carve/carve-js/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

carve-js parses, renders, formats and lints Carve in TypeScript and JavaScript. It is the reference engine
of Carve 0.2. Read the [Carve documentation](https://markup-carve.github.io/carve/) for the language.

## Install

```sh
npm install @markup-carve/carve
```

## Usage

```ts
import { format, lint, parse, render } from '@markup-carve/carve'

const html = render('= Hello /Carve/')
const document = parse('= Hello /Carve/')
const source = format('=  Hello /Carve/')
const diagnostics = lint('See [x][nope].')
const localized = lint('= Alpha\n\nSee [a](#alpha).', { headingIds: 'lower' })
```

`fix(source)` applies the rewrites of `carve lint --fix` and `fixEdits(source, diagnostic)` returns the edits for one
finding, for editor quick fixes ([Lint fixes](docs/api.md#lint-fixes)).

The root entry runs in browsers, Node, Deno and bundlers. `@markup-carve/carve/node` adds
`fileSystemResolver`, the include resolver that reads files. `@markup-carve/carve/import` imports Markdown, GFM,
Djot, BBCode and HTML ([guide](docs/import.md)); the core entry imports HTML. `@markup-carve/carve/upgrade` is the
0.1 to 0.2 source upgrade as a call, and `@markup-carve/carve/prettier` is a Prettier plugin that formats `.crv`
files as `carve fmt` does. A classic-script build is published as
`dist/carve.iife.min.js` (the `unpkg` and `jsdelivr` target) and exposes the same API as a `carve` global.

`@markup-carve/carve/extensions` holds the provisional standard extensions, registered by the host:

- blocks: `details`, `spoiler` (also inline), `listTable`, `imgFence`
- tabs: `standardTabsRenderer({ mode: 'aria' })` selects ARIA controls; CSS radios remain the default
- inline: `colorSwatch`, `wikilinks`, `semanticSpan`, `smartQuotes` (with `smartQuoteLocales`,
  `isSmartQuoteLocaleSupported`, `SMART_QUOTE_LOCALES`)
- document transforms: `defaultAttributes`, `tabNormalize`, `inlineFootnotesToParentheses`
- navigation: `tableOfContents`, `tocPlacement`, `headingPermalinks`, `headingNumbers`, `headingReference`,
  `externalLinks`, `linkPolicy`, `autolink` ([guide](docs/extensions-navigation.md)); the heading shift is the core
  render option `headingShift`

The command line:

```sh
npx carve README.crv > README.html
npx carve fmt --check README.crv
npx carve lint README.crv
npx carve lint --heading-ids lower README.crv
npx carve import --from html page.html
npx carve import --from markdown README.md
npx carve upgrade --check legacy.crv
npx carve upgrade --registered-extension wikilinks legacy-wiki.crv
npx carve fix --write notes.crv
npx carve flatten book.crv > book-all.crv
npx carve diff old.crv new.crv
```

`carve upgrade` rewrites a Carve 0.1 document into 0.2 so that it renders the same. `carve fix` rewrites Markdown and Djot habits such as `**b**` to their Carve spelling, and `carve flatten` writes a document with its includes expanded in place ([engine commands](docs/cli.md)). `carve diff` writes the JSON Patch between
the trees of two files.

## Documentation

- [Library API and migration from 0.1](docs/api.md)
- [Fenced renderers: diagrams, math, code groups and callouts](docs/fenced-renderers.md)
- [Standard extensions: blocks and inline](docs/extensions-blocks-inline.md)
- [Exports: Markdown, plain text and ANSI](docs/export.md) (`@markup-carve/carve/export`)
- [Extensions: glossary, index, citations](docs/extensions-reference.md)
- [Standard extensions: navigation](docs/extensions-navigation.md)
- [Engine notes: conformance, byte input, includes, command line](docs/engine.md)
- [Importing Markdown, Djot, BBCode and HTML](docs/import.md)
- [Engine commands and flags: flatten, fix, upgrade --migrate, --output, --strict, --ignore](docs/cli.md)
- [Development](docs/development.md)
- [Carve documentation](https://markup-carve.github.io/carve/)
- [Playground](https://markup-carve.github.io/carve/playground)

## CI and pre-commit

The repository is a GitHub Action (`markup-carve/carve-js@<tag>`, inputs `files`, `fmt`, `lint`, `version`)
and a pre-commit hook source (hooks `carve-fmt`, `carve-fmt-write`, `carve-lint`). Both run the `carve` bin
of the pinned version.
