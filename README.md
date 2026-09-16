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
import { expandIncludes, parse, renderDocument } from '@markup-carve/carve'

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
// Renders the expanded tree through the same composition `carveToHtml` uses -
// resolution, extension transforms, profile, renderer. See "Rendering a
// document you already hold" below.
const html = renderDocument(expanded.doc)
```

Each warning carries a `file` naming the document it arose in, so a host can
route a diagnostic to the right editor buffer. A directive that failed to
resolve is attributed to the document containing it, not to the target it
names; a warning raised while expanding a child - a heading clamp, an id or
footnote rename, a cycle found deeper in the chain - is attributed to that
child. The value is the resolver's canonical id when it supplies one, and the
`sourcePath` option for the top-level document. It is **absent** when the
top-level document has no `sourcePath`: no placeholder path is invented.

`line` / `column` / `start` / `end` are positions in that `file`'s own source,
and so are the positions on the merged AST nodes: a node an include pulled in
keeps its own file's coordinates and names that file in `pos.file`. A node from
the document being parsed has no `pos.file`, so a tree with no includes is
unchanged. Without it an included span would be ambiguous - a child's first
paragraph and the parent's first paragraph both report line 1.

An inline include's leading and trailing text joins the host's text node, and
that merged node keeps the host's span. Every other node the child contributes
still names the child in `pos.file`.

Pass the parent's `extensions` through as well. An extension that adds syntax
applies only to the parse it is given, so a child read without them renders
`[[Page]]` or `[@knuth]` as literal text while the same line in the parent does
not. Extensions with only render or transform hooks need not be passed here.

On Node, `fileSystemResolver` is a ready-made resolver with canonical
root-containment checks. It lives on the `./node` subpath rather than the main
entry, because it needs `node:fs` and the browser bundle is built from that
entry verbatim:

```ts
import { fileSystemResolver } from '@markup-carve/carve/node'

const expanded = expandIncludes(doc, source, {
  // Canonicalizes first, then rejects any target outside the root - symlink
  // escapes and dot-dot alike. Absolute paths are denied by default, and no
  // target over 4 MiB is read.
  resolve: fileSystemResolver('/srv/docs'),
})
```

**The root itself must be absolute.** A relative one is refused and inclusion
stays disabled, because every canonicalizer resolves a relative spec against
the process working directory, and that is the one root the spec forbids
defaulting to. A front end is free to expand its own relative argument first -
the `carve` CLI does exactly that with `--include-root` - since what is
required is that the root BE absolute, not that nobody may derive one.

A browser or WASM host supplies its own resolver instead, which is the
arrangement the spec describes: the parser performs no file I/O and the host
owns containment.

`expanded.dependencies` lists every include target touched by the whole
recursive expansion (`{ id, resolved }`, de-duplicated, in first-encounter
order). `id` is the resolver's canonical id when it supplies one, otherwise the
directive path. Editors and preview servers watch these paths to know when to
re-render. Targets that failed to resolve - missing files, and paths denied by
root containment - are reported with `resolved: false` rather than omitted, so
a watcher still fires when a missing chapter is finally created. A missing one
is named by where it WOULD be, so `sub/frag.crv` asking for `missing.crv`
reports the canonical `<root>/sub/missing.crv` and the watch lands on the file
the author meant; a path denied by containment keeps the directive's spelling.
A resolver of your own does the same by returning `{ source: null, id }`.
It may also return `{ source: null, id, denial }`, where `denial` is one of
`outside-root`, `not-found`, `no-root`, `denied`, or `unresolved`.

The CLI publishes the same list with `--report-includes FILE`; use `-` to write
it to stderr. The file is written even when no resolver runs, with an empty
array, so a subprocess host can distinguish an empty dependency set from a
missing report:

```bash
carve --report-includes deps.json book/main.crv > main.html
```

```json
{"dependencies":[{"id":"/book/intro.crv","resolved":true},{"id":"gone.crv","resolved":false,"denial":"not-found"}]}
```

`denial` is present when the resolver classified the refusal. It is omitted for
successful reads and engine-side refusals such as a spent expansion budget.
When `-` is used, the JSON is one line among any other diagnostics written to
stderr.

`expanded.chargedBytes` is what the expansion charged against the byte budget,
counted per occurrence rather than per distinct identity. It includes the
target that broke the budget, which was necessarily read before its size could
be known - so a host auditing a budget can tell "read nothing" from "read a
target and refused it". A target refused before the budget check, for being
non-text or a cycle, is not charged; the bound on how much I/O a render may
perform is `maxResolverCalls`, not the byte budget.

#### Finding the directives in a document

An editor that offers go-to-definition on an include path has to decide which
`{{ ... }}` under the cursor is a live directive and which is text - a token in
a code block, in a code span or in a link destination is never expanded, and
neither is one whose options are malformed. `findDirectiveSites` answers that
with the expander's own traversal, so a host cannot disagree with the engine:

```ts
import { findDirectiveSites, parse } from '@markup-carve/carve'

for (const site of findDirectiveSites(parse(source, { positions: true }))) {
  // site.raw is the token, site.start/end bound it in `source`, and
  // site.directive carries the parsed path, section, line range and shift.
  // site.block is true when the directive is a paragraph of its own.
  console.log(site.directive.path, site.raw, site.start)
}
```

Parse with `positions: true` for the offsets to be usable. `start` and `end`
count CODEPOINTS, the unit every `pos` on the tree uses, so a site is cut out
of a buffer the same way any other node is - `[...source].slice(start, end)`,
not `source.slice(start, end)`, which drifts by one per astral character ahead
of the token. `line` and `column` locate the inline node the token starts in -
the same anchor `expandIncludes` attributes its warnings to, so a site matches
up with a warning about it.

For a token a host already holds, `isDirectiveShape` and `parseDirective` answer
without a document. The scan regexes stay internal: matching source text with a
pattern is exactly what disagrees with the engine about a fenced token.

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

`carve flatten` writes the document back as Carve with every include expanded in
place - the deliberate opposite of `carve fmt`, which leaves directives alone so
formatting returns the author's document. Flattening is for handing the document
to something with no filesystem behind it: a web editor, a paste box, a
colleague.

```bash
carve flatten book/main.crv > one-file.crv
carve flatten --include-root ./book < main.crv
```

The output is canonical Carve, so formatting is normalized rather than
preserved, and colliding explicit ids and footnote labels are renamed. The
renames are written into the source, so the flattened file renders exactly like
the expanded original.

Resolvers are deliberately host-supplied. Do not enable includes for untrusted
input unless the resolver canonicalizes paths, rejects root escapes, and applies
the same parsing and sanitization policy as the parent document. A Node helper,
`fileSystemResolver(root)`, enforces canonical root containment and rejects
absolute include paths by default. The root must be named explicitly: a blank or
whitespace-only value is refused rather than canonicalized, because
canonicalizing it would root containment at the process working directory, which
the spec forbids. Containment is checked on the canonical
(symlink-resolved) path, so `../shared/glossary.crv` from `chapters/ch1.crv`
resolves while symlinks, absolute paths, and dot-dot chains leaving the root do
not. Relative paths resolve against the including file; the containment root
stays the single top-level root for nested includes.

The CLI exposes this on `carve render`. For file input the root defaults to the
input file's directory, so `carve input.crv` already resolves includes beside
it; pass `--include-root docs` to widen the root to a shared docs tree (or to
narrow it). Stdin has no path context, so includes there stay literal unless
`--include-root` is given.

### Rendering a document you already hold

`carveToHtml` and its siblings take source. A host that produced a *tree*
instead - `expandIncludes` for a preview with the children merged in, an AST
patch, an editor session, a decoded PART 12 payload - reaches the same
composition with `renderDocument`:

```ts
import { renderDocument, renderDocumentWithReport } from '@markup-carve/carve'

const html = renderDocument(doc, { extensions, target: 'html' })
const report = renderDocumentWithReport(doc, { extensions, strictLosses: true })
```

It runs resolution, the extension transforms (`afterParse`, `beforeRender`),
the profile pass and then the renderer for `target` (`'html'` by default, plus
`'markdown'`, `'plain'`, `'ansi'`) - the same order, entered one step later, so
a host never has to know that order. Composing it by hand is what this
replaces: `applyTransforms` is not public, and a pipeline missing it still
renders, so an extension that contributes a transform (citations numbering its
groups and appending the references list, a heading-level shift, default
attributes) degrades silently instead of failing.

Two obligations, because the seam begins after the parse:

- **Parse with the same `extensions` you pass here.** `matchInline` and
  `matchBlock` run at parse time; passing an extension here reaches only its
  transform and renderer hooks.
- **Parse with `positions: true`**, which the string entry points force.
  Resolution reads a block image's own column for the strict column-0 figure
  rule, so a positionless tree resolves to a different document.

The document is transformed **in place**, as the string entry points transform
the tree they just parsed. That is invisible when the entry point owns a fresh
parse and visible here, so hand over a freshly produced tree - re-parse or
re-expand - rather than one you already rendered.

A profile's `maxLength` is not enforced here - it is a pre-parse guard on
source bytes, and there is no source at this seam. `'carve'` is deliberately
not a target: `carveToCarve` runs a different composition on purpose, because a
formatter must write back what the author wrote.

### Mention and tag resolvers

`mentionUrl` and `tagUrl` remain available for route templates. For application
lookups, configure `resolveMention` or `resolveTag` instead:

```ts
carveToHtml(source, {
  socialContext: currentTenant,
  resolveMention: ({ name, context }) => (context as AppContext).users.get(name)?.url ?? null,
  resolveTag: ({ name, context }) => (context as AppContext).tags.get(name)?.url ?? null,
})
```

A resolver is authoritative for its kind. Returning `null`, throwing, or
returning a denied URL produces the ordinary inert span and never falls back to
the corresponding template. The callback receives the exact parsed name,
read-only attributes, the node kind, and the opaque `socialContext`. Its result
is a complete destination and is not encoded again.

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
