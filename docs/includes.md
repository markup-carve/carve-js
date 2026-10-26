# File inclusion

## Include expansion

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
// resolution, extension transforms, profile, and renderer.
const html = renderDocument(expanded.doc)
```

A resolver may also return `{ source, id }` with `source` as a `Uint8Array`,
which is read as UTF-8. An included file is refused as non-text
(`include-non-text`) when its bytes are not well-formed UTF-8, or when the
string returned holds a lone surrogate or a NUL. It is not repaired: the
U+FFFD replacement of CARVE-P0-023 covers the top-level document only.
`fileSystemResolver` refuses such a file the same way.

Each warning carries a `file` naming the document it arose in, so a host can
route a diagnostic to the right editor buffer. A directive that failed to
resolve is attributed to the document containing it, not to the target it
names; a warning raised while expanding a child; a heading clamp, an id or
footnote rename, a cycle found deeper in the chain; is attributed to that
child. The value is the resolver's canonical id when it supplies one, and the
`sourcePath` option for the top-level document. It is **absent** when the
top-level document has no `sourcePath`: no placeholder path is invented.

`line` / `column` / `start` / `end` are positions in that `file`'s own source,
and so are the positions on the merged AST nodes: a node an include pulled in
keeps its own file's coordinates and names that file in `pos.file`. A node from
the document being parsed has no `pos.file`, so a tree with no includes is
unchanged. Without it an included span would be ambiguous; a child's first
paragraph and the parent's first paragraph both report line 1.

A warning attributed to a child also carries `includedBy`: the directives that
pulled that file in, root first, each bounding the directive token in the file
that wrote it. `includedBy[0]` is therefore a position in the top-level
document, which is what an editor needs; the author has the root open, and a
child's offsets name nothing in it. `[...source].slice(start, end).join('')`
reads the token back out of the file `site.file` names.

The field is **absent**, never empty, on a warning raised in the top-level
document, including one about a directive there that failed to resolve: such a
warning is attributed to the document that wrote the directive, and its own
`line` / `column` / `start` / `end` already name a position in it. So
`includedBy === undefined` and "this warning is in the root" are one question.

Reconstructing the chain from the resolver calls a host saw is exact only while
every target is written once and reached once. The same target written twice
resolves under one canonical id, and so does one child reached under two
top-level directives, so only the engine can say which occurrence a warning
came from.

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
  // Canonicalizes first, then rejects any target outside the root; symlink
  // escapes and dot-dot alike. Absolute paths are denied by default, and no
  // target over 4 MiB is read.
  resolve: fileSystemResolver('/srv/docs'),
})
```

**The root itself must be absolute.** A relative one is refused and inclusion
stays disabled, because every canonicalizer resolves a relative spec against
the process working directory, and that is the one root the spec forbids
defaulting to. A front end is free to expand its own relative argument first -
the `carve` CLI does exactly that with `--include-root`; since what is
required is that the root BE absolute, not that nobody may derive one.

A browser or WASM host supplies its own resolver instead, which is the
arrangement the spec describes: the parser performs no file I/O and the host
owns containment.

`expanded.dependencies` lists every include target touched by the whole
recursive expansion (`{ id, resolved }`, de-duplicated, in first-encounter
order). `id` is the resolver's canonical id when it supplies one, otherwise the
directive path. Editors and preview servers watch these paths to know when to
re-render. Targets that failed to resolve; missing files, and paths denied by
root containment; are reported with `resolved: false` rather than omitted, so
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
be known; so a host auditing a budget can tell "read nothing" from "read a
target and refused it". A target refused before the budget check, for being
non-text or a cycle, is not charged; the bound on how much I/O a render may
perform is `maxResolverCalls`, not the byte budget.

#### Finding the directives in a document

An editor that offers go-to-definition on an include path has to decide which
`{{ ... }}` under the cursor is a live directive and which is text; a token in
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
of a buffer the same way any other node is; `[...source].slice(start, end)`,
not `source.slice(start, end)`, which drifts by one per astral character ahead
of the token. `line` and `column` locate the token's first character; the
same anchor `expandIncludes` attributes its warnings to, so a site matches
up with a warning about it.

For a token a host already holds, `isDirectiveShape` and `parseDirective` answer
without a document. The scan regexes stay internal: matching source text with a
pattern is exactly what disagrees with the engine about a fenced token.
`parseDirective(raw, onInvalidOption, onSecondSection, onRepeatedOption)` takes
three optional callbacks for the malformed cases `expandIncludes` warns about:
an unknown or malformed `@option` (`include-unknown-option`), a second
`#section` name (`include-selection-conflict`) and an option key given twice,
such as `@code:js @code:py` (`include-duplicate-option`). In each case it
returns `null`.

Supported directive options are `#section`, `@lines:N-M`, `@region:name`,
`@code` / `@code:lang`, and `@shift:N` / `@shift:auto`, each at most once. A
directive uses at most one selection option. `#section` selects a heading subtree by id or slug,
`@lines` selects an inclusive physical line range, and `@region` selects lines
between matching markers. In a Carve include, only `%% #region name` and
`%% #endregion name` are markers, and the selected content is parsed as Carve.
In a code include, bare `#region`, `//`, `--`, `/* */`, `<!-- -->`, and `%%`
comment forms are recognized. Marker keywords are case-sensitive. Invalid or
missing regions warn with `include-region-invalid` and leave the directive
literal. A file's leading U+FEFF is skipped before markers are matched, so a
marker on line 1 still counts. An `@lines` range that starts past the last line
warns with `include-lines-out-of-range` and leaves the directive literal; one
that starts inside the file and ends past it is clamped.

`selectIncludeRegion(source, name, mode)` answers the same question for a host,
with `mode` `'carve'` or `'code'`: `{ ok: true, start, end }` gives the 1-based,
inclusive content lines (the opening marker is on `start; 1`), and
`{ ok: false, rule: 'include-region-invalid' }` a region the expander would
refuse. An editor jumping to a region calls it instead of copying the marker
rules.

`@code` emits one unparsed code block. `@code:lang` sets its fence language;
without a language, none is inferred. It works with `@lines` or `@region`, but
not `#section`. A block attribute line above the directive applies to the code
block. `@shift` has no effect on a code include; otherwise, it moves included
heading levels, clamped to `h1`...`h6`.

`@shift:auto` derives the offset from the include site instead of stating it:
the content is placed one level below the nearest preceding heading in the
directive's own container or an enclosing one (a heading in a sibling container
that has already closed does not count). The offset is
`(context level + 1); (minimum heading level in the included content)`, so the
child's internal structure is preserved and a file written with an `h1` title
slots in wherever it is included. Content with no headings is left alone.
Heading ids and slugs never change, so cross-references into shifted headings
keep resolving.

`carve flatten` writes the document back as Carve with every include expanded in
place; the deliberate opposite of `carve fmt`, which leaves directives alone so
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
