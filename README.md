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

Tools that need to retain unrelated source bytes can use `carveToCarvePatch`
and `applySourcePatch`; see
[source-preserving patches](https://github.com/markup-carve/carve-js/blob/main/docs/source-patches.md).

HTML rendering accepts a `symbols` map for symbol shortcodes (e.g. emoji):
mapped values are trusted raw HTML output, and unmapped `:name:` shortcodes
render literally.

It runs in a browser too, from a script tag or a module -
[docs/browser.md](https://github.com/markup-carve/carve-js/blob/main/docs/browser.md).

### Includes

File inclusion is an opt-in processor pass. The core parser leaves `{{ path }}`
literal unless you call `expandIncludes` with a resolver:

```ts
import { expandIncludes, parse, resolve, renderHtml } from '@markup-carve/carve'

const source = 'Intro\n\n{{ chapter.crv @shift:1 }}'
const expanded = expandIncludes(parse(source, { positions: true }), source, {
  resolve(path, ctx) {
    // Return the child source string, throw, or return null when unresolvable.
    // `ctx.sourcePath` and `ctx.stack` let hosts resolve relative paths.
    return files.get(path) ?? null
  },
})

for (const warning of expanded.warnings) {
  console.warn(`${warning.file ?? '<input>'}:${warning.line} ${warning.message}`)
}
const html = renderHtml(resolve(expanded.doc))
```

Each warning carries a `file` naming the document it arose in, so a host can
route a diagnostic to the right editor buffer. A directive that failed to
resolve is attributed to the document containing it, not to the target it
names; a warning raised while expanding a child - a heading clamp, an id or
footnote rename, a cycle found deeper in the chain - is attributed to that
child. The value is the resolver's canonical id when it supplies one, and the
`sourcePath` option for the top-level document. It is **absent** when the
top-level document has no `sourcePath`: no placeholder path is invented.

`line` / `column` / `start` / `end` are positions in that `file`'s own source.
Positions on merged AST nodes are not yet remapped into the assembled
document - see the follow-up on source-position remapping (spec section 19,
I4).

`expanded.dependencies` lists every include target touched by the whole
recursive expansion (`{ id, resolved }`, de-duplicated, in first-encounter
order). `id` is the resolver's canonical id when it supplies one, otherwise the
directive path. Editors and preview servers watch these paths to know when to
re-render. Targets that failed to resolve - missing files, and paths denied by
root containment - are reported with `resolved: false` rather than omitted, so
a watcher still fires when a missing chapter is finally created.

Supported directive options are `#section`, `@lines:N-M`, and
`@shift:N` / `@shift:auto`. `#section` selects the heading subtree by explicit
id or auto slug, `@lines` selects an inclusive physical line range before
parsing, and `@shift` shifts included heading levels with clamping to
`h1`...`h6`.

`@shift:auto` derives the offset from the include site instead of stating it:
the content is placed one level below the nearest preceding heading in the
directive's own container or an enclosing one (a heading in a sibling container
that has already closed does not count). The offset is
`(context level + 1) - (minimum heading level in the included content)`, so the
child's internal structure is preserved and a file written with an `h1` title
slots in wherever it is included. Content with no headings is left alone.
Heading ids and slugs never change, so cross-references into shifted headings
keep resolving.

Resolvers are deliberately host-supplied. Do not enable includes for untrusted
input unless the resolver canonicalizes paths, rejects root escapes, and applies
the same parsing and sanitization policy as the parent document. A Node helper,
`fileSystemResolver(root)`, enforces canonical root containment and rejects
absolute include paths by default. Containment is checked on the canonical
(symlink-resolved) path, so `../shared/glossary.crv` from `chapters/ch1.crv`
resolves while symlinks, absolute paths, and dot-dot chains leaving the root do
not. Relative paths resolve against the including file; the containment root
stays the single top-level root for nested includes.

The CLI exposes this on `carve render`. For file input the root defaults to the
input file's directory, so `carve input.crv` already resolves includes beside
it; pass `--include-root docs` to widen the root to a shared docs tree (or to
narrow it). Stdin has no path context, so includes there stay literal unless
`--include-root` is given.

### Heading ids

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
- [Source-preserving patches](https://github.com/markup-carve/carve-js/blob/main/docs/source-patches.md) - stale-safe UTF-8 edits.
- [Development](https://github.com/markup-carve/carve-js/blob/main/docs/development.md) - the checkout, the layout, the roadmap.

Try Carve live in the [playground](https://markup-carve.github.io/carve/playground),
which runs this implementation in the browser.
