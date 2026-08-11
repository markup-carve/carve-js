# carve-js

Reference TypeScript implementation of the [Carve](https://github.com/markup-carve/carve) markup language.

Implements **Carve spec 0.1** (see [Versioning & Changelog](https://markup-carve.github.io/carve/versioning)).

> **Status:** the parser, renderers, and migration tooling are implemented and pass the spec corpus.

## What this is

- A linear-time parser for `.crv` source → typed AST
- Renderers to HTML (canonical), Markdown, plain text, and ANSI
- A test runner that validates output against the [shared corpus](https://github.com/markup-carve/carve/tree/main/tests/corpus)

The spec, EBNF grammar, and example pairs live in the upstream [`markup-carve/carve`](https://github.com/markup-carve/carve) repo, pulled in here as a git submodule under [`spec/`](./spec). The corpus at `spec/tests/corpus/` is the contract this implementation honors.

## Import HTML

```ts
import { htmlToCarve } from '@markup-carve/carve'

const { value, report } = htmlToCarve(html, { mode: 'safe', adapter: 'generic' })
```

The importer uses an HTML5 DOM, builds a Carve AST, and delegates source output
to the canonical writer. `report.diagnostics` records every lossy decision.
Use `semantic` for trusted editor HTML and `roundtrip` only for Carve-produced
HTML. The CLI equivalent is `carve migrate --from html --report report.json`.

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

### Renderers refuse a tree that nests too deeply

Every `render*` function stops at `MAX_RENDER_DEPTH` and throws a
`RenderDepthError` naming the bound, rather than truncating the output or
letting the host stack run out:

```ts
import { renderHtml, RenderDepthError, MAX_RENDER_DEPTH } from '@markup-carve/carve'

try {
  renderHtml(doc)
} catch (err) {
  if (err instanceof RenderDepthError) {
    // err.renderer, err.depth === MAX_RENDER_DEPTH
  }
}
```

Nothing `parse` produces can reach the ceiling - it sits above the parser's own
nesting cap - so this only applies to a tree you built through the API or
decoded from somewhere else. A renderer that stopped emitting instead would
hand back a document that looks complete and is not.

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

### Section wrappers

A top-level heading is wrapped, along with the content following it up to the
next same-or-shallower heading, in a `<section>` that carries the heading's id
(spec PART 9 §13). Only the id moves - `{#install .featured}` gives
`<section id="install"><h2 class="featured">` - and a heading inside a
blockquote, div, or list item is not wrapped at all.

Pass `sections: false` to render headings flat, with the id back on the `<h*>`:

```ts
carveToHtml('# A\n\np\n')
// <section id="A">
//   <h1>A</h1>
//   <p>p</p>
// </section>

carveToHtml('# A\n\np\n', { sections: false })
// <h1 id="A">A</h1>
// <p>p</p>
```

This exists for sites whose CSS or JS assumes rendered blocks are direct
children of the content container - the `.stack > * + *` spacing idiom,
`:first-child`, `nth-child()` counting, `element.children` walks - all of which
stop matching once a wrapper sits in between. It is the one output change that
breaks a document whose *source* migrated cleanly.

Nothing else changes when it is off: ids, collision dedup, `</#id>`
cross-references, implicit `[Heading][]` references, `::: toc`, endnotes
placement and heading numbering all resolve against the slug rather than the
element carrying it. The endnotes `<section role="doc-endnotes">` is a separate
construct and is still emitted. The option is HTML-only - no other target emits
`<section>`, and the AST has no `section` node.

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
`carve render --ansi`). For anything you did not author, add `--safe` and
optionally `--profile` - see [Untrusted input](#untrusted-input). Three more
subcommands round out the tooling:

```bash
carve fmt  file.crv        # print canonically formatted Carve to stdout
carve fmt -w   file.crv    # format in place
carve fmt --check src/     # exit non-zero if any file is not formatted (CI gate)
carve fmt --stamp file.crv # also append a provenance marker (spec version + engine)
carve fix  file.crv        # auto-fix Djot/Markdown delimiter collisions
carve lint file.crv        # validate: collisions + silent-failure problems
carve diff a.crv b.crv     # semantic changes, ignoring source reflow
carve merge base.crv ours.crv theirs.crv # merge independent edits
carve portability file.crv # report where the document reads differently in Djot
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
`--stamp-block` for the multi-line `%%%` block form. The same logic is available
as `stampCarve(formatted, 'carve-js 0.1.0')`.

The marker is machine-readable, so flagging documents that predate a breaking
spec change does not have to be done by eye:

```bash
carve --stamp-info doc.crv    # report the version and the writer
carve --stamp-check doc.crv   # exit 1 when the document predates this spec version
```

`--stamp-check` works as a CI gate over a directory of stored documents. An
**unstamped** document counts as needing review: its provenance is unknown, and
assuming it is current is the unsafe direction. Programmatically, `readStamp(src)`
returns `{version, generatedBy}` or `null`, and `needsReview(src)` answers the
same question as the flag.

Both marker forms are read, and a marker written by another implementation reads
the same - that is the point of recording it. What to do with the answer is the
[versioning contract](https://markup-carve.github.io/carve/versioning): only
`[behavior]` changelog entries between the stamped version and yours can require
a document change.

`carve diff` compares the normative PART 12 trees rather than source lines, so
rewrapping and re-indenting are not changes while an edited destination,
attribute, node, or node order is. `--json` returns stable paths and change
kinds for applications.

`carve merge` performs a conservative three-way merge over the same exchange
tree. Give it the common base followed by the two revisions; independent edits
are written as canonical Carve source. Ambiguous edits exit 1 and name their
JSON Pointer paths instead of choosing a winner. `--json` emits either the
merged AST or the complete conflict list. Concurrent insertion, deletion,
reordering, and a move on one side plus an edit on the other are reconciled by
node identity and order constraints; contradictory orders and delete-vs-edit
remain conflicts. Duplicate siblings are occurrence-matched, with a bounded
linear fallback for very large ambiguous lists.

Programmatically, `mergeAst(base, ours, theirs, { resolve })` lets an application
resolve selected conflicts as `base`, `ours`, `theirs`, or a supplied value.
`createAstPatch(before, after)` and `applyAstPatch(ast, operations)` provide a
serializable, position-independent patch format for storing or transporting the
same semantic edits. Merged and patched trees omit positions and serialize to
canonical source: the PART 12 AST does not contain the source-layout sidecar, so
claiming whitespace-preserving merge from those three trees would be false.

`carve lint` is a validator for problems that *parse* but render as the wrong
thing (so nothing throws): broken `</#id>` cross-references, duplicate heading
ids, unresolved reference links, missing/duplicate/unused footnotes, a trailing
`{…}` on a heading (literal text, not an attribute block), a legacy
`` ```raw FORMAT `` fence (use `` ```=FORMAT ``), a line that opens like a block
(`:::`, `{#`) but parsed as plain text, and a document declaring a Carve version
this engine does not implement. It exits non-zero when it reports anything, so it
works as a CI gate. The same checks surface live in editors
through [carve-lsp](https://github.com/markup-carve/carve-lsp).

`carve portability` answers a different question: not "is this right in Carve"
but "does it mean the same thing in Djot" - for a document that has to survive
both readers. It renders with both engines and reports the first place they
disagree, so it is a measurement rather than a heuristic; a first attempt that
*reasoned* about the same question as a lint rule was withdrawn for
unsoundness (carve-js#546). Carve's deliberate departures (`/italic/`, `=mark=`,
quoted link titles) are genuine divergences and are reported as such. It needs
djot.js, which this package does not depend on - `npm install @djot/djot`
alongside. See [Portability](docs/migration.md#portability).

`carve-version-unsupported` reads a frontmatter `carve-version:` key - the
author-facing declaration of which Carve version a document targets - and warns
when it is newer than this engine implements, since constructs added after that
version will not render as intended. Declaring one is optional. A document with
no frontmatter key falls back to the trailing `%% carve-version:` provenance
marker, so anything `carve fmt --stamp` has touched is covered too; when both are
present the author's declaration wins.

## Running it for people (CI, hooks, Prettier)

`carve fmt --check` and `carve lint` are only useful if they run without anyone
remembering to type them. Three integrations ship with this package, and all
three drive the same binary at the same version - so they cannot disagree about
what canonical form is.

### GitHub Action

```yaml
- uses: markup-carve/carve-js@v0.1.2
  with:
    files: 'docs/**/*.crv'   # default: **/*.crv
```

Runs `carve fmt --check` and `carve lint` over the matched documents. Both run
even when the first fails, so one push shows every problem rather than the
formatting one today and the lint one tomorrow. A repository with no Carve
documents yet passes rather than failing on an empty glob.

Inputs: `files`, `fmt`, `lint`, `from-djot`, `portable`, `version`.

### pre-commit

```yaml
repos:
  - repo: https://github.com/markup-carve/carve-js
    rev: v0.1.2
    hooks:
      - id: carve-fmt      # report; use carve-fmt-write to fix in place
      - id: carve-lint
```

`language: node` makes [pre-commit](https://pre-commit.com) install this package
at the pinned `rev`, so the hook and the Action run the same engine - which is
the only thing that makes pinning a rev worth anything.

### Prettier

```json
{ "plugins": ["@markup-carve/carve/prettier"] }
```

Prettier then formats `.crv` and `.carve` files, with no `overrides` block
needed. The plugin does not reimplement anything: it hands the source to the
same formatter, so `prettier --write` and `carve fmt --write` produce
byte-identical output, down to the trailing newline.

Prettier's layout options are deliberately ignored. `printWidth`, `tabWidth` and
`useTabs` describe a formatter's freedom, and Carve's canonical form has none -
PART 11 of the grammar fixes it. Honoring `printWidth` here would produce output
that `carve fmt --check` then rejects.

## Untrusted input

The always-on baseline needs no configuration: dangerous URL schemes are blanked
(`javascript:`, `data:`, and the rest of the spec's denylist), event-handler
attributes like `onclick` are dropped, and the bidi override/isolate characters
behind Trojan Source (U+202A-202E, U+2066-2069) are removed from rendered text -
while the legitimate LRM/RLM marks are kept. That much is normative, so every
implementation does it.

The one thing you must opt out of is raw passthrough. A ` ```=html ` block or
`` `…`{=html} `` span is emitted **verbatim** into the HTML output by design, so
anything you did not author needs:

``` js
import { carveToHtml, Profile } from '@markup-carve/carve'

const html = carveToHtml(userInput, {
  allowRawHtml: false,          // escape =html blocks/spans instead of emitting
  profile: Profile.comment(),   // full | article | comment | minimal
})
```

`allowRawHtml: false` is HTML-specific, because HTML is the only target that can
emit live markup - `--markdown` escapes raw HTML, `--plain` drops it, `--ansi`
and `--carve` keep it as text. A `Profile` restricts which constructs are allowed
at all, caps input length, and pairs with `LinkPolicy` for destinations; it is
accepted by every renderer except the formatter (`carveToCarve`), which
deliberately formats what the author wrote rather than the filtered result.

Same thing from the CLI:

```bash
carve --safe untrusted.crv                      # or --no-raw-html
carve --safe --profile comment untrusted.crv
```

Full recipe, defaults, the threat model and a checklist:
[Security](https://markup-carve.github.io/carve/security).

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
