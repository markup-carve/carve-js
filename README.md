# carve-js

Reference TypeScript implementation of the [Carve](https://github.com/markup-carve/carve) markup language.

Implements **Carve spec 0.1** (see [Versioning & Changelog](https://markup-carve.github.io/carve/versioning)).

> **Status:** the parser, renderers, and migration tooling are implemented and pass the spec corpus.

## What this is

- A linear-time parser for `.crv` source → typed AST
- Renderers to HTML (canonical), Markdown, plain text, and ANSI
- A test runner that validates output against the [shared corpus](https://github.com/markup-carve/carve/tree/main/tests/corpus)

The spec, EBNF grammar, and example pairs live in the upstream [`markup-carve/carve`](https://github.com/markup-carve/carve) repo, pulled in here as a git submodule under [`spec/`](./spec). The corpus at `spec/tests/corpus/` is the contract this implementation honors.

## Install

```sh
npm install @markup-carve/carve
```

Working on carve-js itself instead? See
[docs/development.md](https://github.com/markup-carve/carve-js/blob/main/docs/development.md).

## Usage

```ts
import { carveToHtml } from '@markup-carve/carve'

carveToHtml('# Hello\n\nThis is /italic/ and *bold*.')
// <section id="Hello">
//   <h1>Hello</h1>
//   <p>This is <em>italic</em> and <strong>bold</strong>.</p>
// </section>
```

The package exposes one-call converters per output format, plus the lower-level
`parse` / `resolve` / `render*` functions for inspecting or transforming the AST:

```ts
import {
  carveToHtml,
  carveToHtmlWithReport,
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

Raw nodes are routed to their named target. If omitted content must be
observable, use the checked sibling of either API:

```ts
const result = carveToHtmlWithReport('`x`{=latex}')
// result.value is the unchanged HTML output
// result.losses[0].code === 'raw-format-dropped'

carveToHtmlWithReport('`x`{=latex}', { strictLosses: true })
// throws RenderLossError before a value is returned
```

Reports are bounded to 100 entries by default while `totalLosses` retains the
complete count. Set `maxRenderLosses` to change the bound. The compatible
string-returning APIs remain available.

HTML rendering accepts a `symbols` map for symbol shortcodes (e.g. emoji):
mapped values are trusted raw HTML output, and unmapped `:name:` shortcodes
render literally.

It runs in a browser too, from a script tag or a module -
[docs/browser.md](https://github.com/markup-carve/carve-js/blob/main/docs/browser.md).

How the renderers derive heading ids, wrap sections and bound nesting depth
is in [docs/rendering.md](https://github.com/markup-carve/carve-js/blob/main/docs/rendering.md).

## Import HTML

`htmlToCarve` and `htmlToAst` convert HTML into Carve, with ordered loss
diagnostics and safe / semantic / trusted-roundtrip policies:

```js
import { htmlToCarve } from '@markup-carve/carve'

const { carve, losses } = htmlToCarve('<h1>Title</h1>', { mode: 'safe' })
```

Markdown and Djot convert in as well (`markdownToCarve`, `djotToCarve`).
What the HTML importer models and what it deliberately does not is in
[docs/html-import.md](https://github.com/markup-carve/carve-js/blob/main/docs/html-import.md).

## CLI

```sh
npx carve README.crv > README.html   # render (HTML by default)
npx carve --markdown README.crv      # or --plain, --ansi, --json
npx carve lint README.crv            # report problems, change nothing
npx carve fmt -w README.crv          # format canonically
```

Every subcommand and flag is in [docs/cli.md](https://github.com/markup-carve/carve-js/blob/main/docs/cli.md). For running it
over a repository - a GitHub Action, a pre-commit hook, or Prettier - see
[docs/integrations.md](https://github.com/markup-carve/carve-js/blob/main/docs/integrations.md).

## Untrusted input

Rendering attacker-controlled Carve needs the safe path: `--safe` on the CLI,
or the checked render options in the library, which escape raw HTML instead
of emitting it. Nesting depth and other renderer limits are bounded by
default. The threat model and every knob is in [docs/security.md](https://github.com/markup-carve/carve-js/blob/main/docs/security.md).


## Documentation

- [Extensions](https://github.com/markup-carve/carve-js/blob/main/docs/extensions.md) - opt-in extensions (`smartQuotes`, `tabNormalize`,
  `details`, `tabs`, `codeGroup`, `mermaid`, `wikilinks`, `externalLinks`,
  `headingPermalinks`, `tableOfContents`, `autolink`) and how to add your own
  syntax with parse-stage matchers.
- [Migration and linting](https://github.com/markup-carve/carve-js/blob/main/docs/migration.md) - `markdownToCarve`,
  `djotToCarve`,
  Djot collision warnings + `carve fix`, and `lintCarve` / `carve lint`.

- [HTML import](https://github.com/markup-carve/carve-js/blob/main/docs/html-import.md) - what the importer models, and what it does not.
- [Command line](https://github.com/markup-carve/carve-js/blob/main/docs/cli.md) - every subcommand and flag.
- [Integrations](https://github.com/markup-carve/carve-js/blob/main/docs/integrations.md) - GitHub Action, pre-commit, Prettier.
- [Untrusted input](https://github.com/markup-carve/carve-js/blob/main/docs/security.md) - the threat model and the safe path.
- [Rendering behavior](https://github.com/markup-carve/carve-js/blob/main/docs/rendering.md) - heading ids, section wrappers, depth limits.
- [Browser use](https://github.com/markup-carve/carve-js/blob/main/docs/browser.md) - script tag and module.
- [Accessibility lint](https://github.com/markup-carve/carve-js/blob/main/docs/accessibility-lint.md) - the accessibility rules.
- [Streaming render](https://github.com/markup-carve/carve-js/blob/main/docs/streaming-render.md) - rendering without buffering.
- [Reversible patches](https://github.com/markup-carve/carve-js/blob/main/docs/reversible-patches.md) - editing an AST in place.
- [Development](https://github.com/markup-carve/carve-js/blob/main/docs/development.md) - the checkout, the layout, the roadmap.

Try Carve live in the [playground](https://markup-carve.github.io/carve/playground),
which runs this implementation in the browser.
