# carve-js

Reference TypeScript implementation of the [Carve](https://github.com/markup-carve/carve) markup language.

Implements **Carve spec 0.1** (see [Versioning & Changelog](https://markup-carve.github.io/carve/versioning)).

> **Status:** the parser, renderers, and migration tooling are implemented and pass the spec corpus.

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

HTML rendering accepts a `symbols` map for symbol shortcodes (e.g. emoji):
mapped values are trusted raw HTML output, and unmapped `:name:` shortcodes
render literally.

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

for (const warning of expanded.warnings) console.warn(warning.message)
const html = renderHtml(resolve(expanded.doc))
```

`expanded.dependencies` lists every include target touched by the whole
recursive expansion (`{ id, resolved }`, de-duplicated, in first-encounter
order). `id` is the resolver's canonical id when it supplies one, otherwise the
directive path. Editors and preview servers watch these paths to know when to
re-render. Targets that failed to resolve - missing files, and paths denied by
root containment - are reported with `resolved: false` rather than omitted, so
a watcher still fires when a missing chapter is finally created.

Supported directive options are `#section`, `@lines:N-M`, and `@shift:N`.
`#section` selects the heading subtree by explicit id or auto slug, `@lines`
selects an inclusive physical line range before parsing, and `@shift` shifts
included heading levels with clamping to `h1`...`h6`.

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

Every heading gets an automatic id derived from its text. Ids are
**case-preserving** and keep non-ASCII verbatim by default (`# Über uns` ->
`Über-uns`); cross-references (`</#uber-uns>`) resolve case-insensitively. Two
orthogonal options on every converter (and on `resolve` / `lintCarve`) adjust
the slug:

| Option | Values | Effect |
|--------|--------|--------|
| `asciiHeadingIds` | `false` (default) | keep non-ASCII verbatim |
| | `true` / `'fold'` | best-effort: transliterate non-ASCII to ASCII, but scripts the map can't handle (Greek, CJK, Arabic, emoji) are kept verbatim |
| | `'strict'` | guarantee a pure-ASCII id (`[0-9A-Za-z-]`): transliterate, then drop any unmappable residue |
| `lowercaseHeadingIds` | `false` (default) / `true` | lowercase the id (GitHub/SSG-style anchors) |

The two combine - `'strict'` plus `lowercaseHeadingIds` yields a fully lowercase
ASCII slug.

```ts
carveToHtml('# Café 日本語', { asciiHeadingIds: 'fold' })   // id="Cafe-日本語"
carveToHtml('# Café 日本語', { asciiHeadingIds: 'strict' }) // id="Cafe"
carveToHtml('# Über uns', { asciiHeadingIds: 'strict', lowercaseHeadingIds: true }) // id="uber-uns"
```

Under `'strict'`, a heading made entirely of unmappable script has no ASCII
left and falls back to the id `s` (then `s-2`, ...); attach an explicit
`{#my-id}` to such a heading for a meaningful anchor.

## CLI

The package installs a `carve` binary. Rendering is the default action — it
reads a file or stdin and writes the rendered output to stdout. HTML is the
default; pass a format flag for Markdown, plain text, or ANSI:

```bash
carve README.crv > README.html   # HTML (default)
carve --markdown README.crv      # Markdown
carve --plain README.crv         # plain text
carve --ansi README.crv          # ANSI-colored terminal text
carve --carve README.crv         # canonical Carve source (formatter)
echo '# Hello' | carve           # render from stdin
```

`--html` / `--markdown` (`--md`) / `--plain` (`--plain-text`) / `--ansi` /
`--carve` select the format (the explicit `render` subcommand also works:
`carve render --ansi`). Three more subcommands round out the tooling:

```bash
carve fmt  file.crv        # print canonically formatted Carve to stdout
carve fmt -w   file.crv    # format in place
carve fmt --check src/     # exit non-zero if any file is not formatted (CI gate)
carve fmt --stamp file.crv # also append a provenance marker (spec version + engine)
carve fix  file.crv        # auto-fix Djot/Markdown delimiter collisions
carve lint file.crv        # validate: collisions + silent-failure problems
carve --help
```

`carve fmt` rewrites Carve into a canonical form: it strips trailing whitespace,
collapses blank-line runs, normalizes list markers (`-`), heading hashes, fence
lengths, and attribute spacing. It is conservative (no reflow, no reference/inline
link conversion, no list renumbering) and semantic-preserving - the rendered HTML
is byte-identical before and after - so it is safe to run on a whole tree. The
same canonical serializer is available programmatically as `carveToCarve(src)`.

`carve fmt --stamp` additionally appends a *provenance marker* - a comment at the
end of the document recording the Carve spec version it was processed under and
the engine that wrote it:

```
%% carve-version: 0.1; generated-by: carve-js 0.1.0
```

It is deterministic (no timestamp) and replace-in-place, so re-stamping is
idempotent; it renders nothing and a plain `carve fmt` preserves it. Use
`--stamp-block` for the multi-line `%%%` block form. The marker records which
spec version a document was last processed under, so future tooling can flag
documents predating a breaking spec change. The same logic is available as
`stampCarve(formatted, 'carve-js 0.1.0')`.

`carve lint` is a validator for problems that *parse* but render as the wrong
thing (so nothing throws): broken `</#id>` cross-references, duplicate heading
ids, unresolved reference links, missing/duplicate/unused footnotes, a trailing
`{…}` on a heading (literal text, not an attribute block), a legacy
`` ```raw FORMAT `` fence (use `` ```=FORMAT ``), and a line that opens like a
block (`:::`, `{#`) but parsed as plain text. It exits non-zero when it reports
anything, so it works as a CI gate. The same checks surface live in editors
through [carve-lsp](https://github.com/markup-carve/carve-lsp).

## Documentation

- [Extensions](https://github.com/markup-carve/carve-js/blob/main/docs/extensions.md) - opt-in extensions (`tabNormalize`,
  `details`, `mermaid`, `wikilinks`, `externalLinks`, `headingPermalinks`,
  `tableOfContents`, `autolink`) and how to add your own syntax with
  parse-stage matchers.
- [Migration and linting](https://github.com/markup-carve/carve-js/blob/main/docs/migration.md) - `markdownToCarve`,
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
│   ├── cli.ts              `carve` binary (render, fmt, fix, lint)
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
