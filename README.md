# carve-js

[![CI](https://github.com/markup-carve/carve-js/actions/workflows/ci.yml/badge.svg)](https://github.com/markup-carve/carve-js/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

carve-js parses and renders Carve in TypeScript and JavaScript. It implements Carve spec 0.1.
Read the [Carve documentation](https://markup-carve.github.io/carve/) for the language.

## Install

```sh
npm install @markup-carve/carve
```

## Usage

```ts
import { parse, renderHtml, resolve } from '@markup-carve/carve'

const document = resolve(parse('# Hello /Carve/'))
const html = renderHtml(document)
```

CLI basics:

```sh
npx carve README.crv > README.html
npx carve lint README.crv
npx carve fmt README.crv
npx carve migrate --from html page.html
```

## Carve 0.2

The Carve 0.2 engine is published beside the 0.1 API as `@markup-carve/carve`, for browsers, Node and
bundlers, with `@markup-carve/carve/node` for the file system include resolver. The package root stays 0.1.

```ts
import { parse, render } from '@markup-carve/carve'

const html = render('= Hello /Carve/')
const document = parse('= Hello /Carve/')
```

The [0.2 API guide](docs/api.md) lists every call and its errors, and maps each 0.1 call to its 0.2 replacement.
The Markdown, plain-text and ANSI writers of 0.1 are being ported to 0.2.

## Documentation

- [Carve documentation](https://markup-carve.github.io/carve/)
- [Playground](https://markup-carve.github.io/carve/playground)
- [Engine guides](docs/README.md)
- [Security for untrusted input](docs/security.md)
- [Development and contributing](docs/development.md)
