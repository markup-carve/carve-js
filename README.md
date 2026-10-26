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

## Documentation

- [Carve documentation](https://markup-carve.github.io/carve/)
- [Playground](https://markup-carve.github.io/carve/playground)
- [Engine guides](docs/README.md)
- [Security for untrusted input](docs/security.md)
- [Development and contributing](docs/development.md)
