# Library API

`@markup-carve/carve` is the public API of the Carve 0.2 engine. It follows the library calls of
`spec/0.2/tooling.md` (C2-T-005) and refuses with the typed errors of C2-T-040. It replaces the 0.1 API of
the same package; [Migrating from 0.1](#migrating-from-01) maps each 0.1 call to its replacement.

| Entry | Runs in | Holds |
|---|---|---|
| `@markup-carve/carve` | browsers, Node, Deno, bundlers (Vite, webpack, Astro, Obsidian) | every call below |
| `@markup-carve/carve/node` | Node | `fileSystemResolver`, the include resolver that reads files |
| `@markup-carve/carve/upgrade` | browsers, Node, bundlers | `upgrade`, the 0.1 to 0.2 source upgrade; it carries the 0.1 reader |
| `@markup-carve/carve/prettier` | Prettier 3 | the Prettier plugin for `.crv` files |

Both entries are ES modules with TypeScript declarations. The only runtime dependency is `parse5`, which the
HTML importer uses.

## Calls

| Call | Takes | Returns | Refuses with |
|---|---|---|---|
| `parse` | source (string or UTF-8 bytes), `ParseOptions` | the resolved tree (`DocumentNode`) | `CarveOptionError` |
| `parseWithDiagnostics` | as `parse` | `{ document, diagnostics, suppressedDiagnostics }` | `CarveOptionError` |
| `parseWithLayout` | as `parse` | the same and `layout`, the source-layout sidecar | `CarveOptionError` |
| `render` | source or a tree, `RenderOptions` | HTML | `CarveOptionError`, `CarveInputError`, `CarveRenderError`, `CarveTreeError` |
| `renderWithDiagnostics` | as `render` | `{ html, diagnostics, suppressedDiagnostics }` | as `render` |
| `format` | source, `{ alignTables, normalize, extensions }` | canonical source | `CarveOptionError`, `CarveWriteError` |
| `formatWithDiagnostics` | as `format` | `{ source, diagnostics }` | `CarveOptionError` |
| `write` | a tree, `{ layout, alignTables, extensions, check }` | canonical source | `CarveOptionError`, `CarveTreeError`, `CarveWriteError` |
| `writeWithDiagnostics` | as `write` | `{ source, diagnostics }` | `CarveOptionError`, `CarveTreeError` |
| `lint` | source, `{ rules, platforms, includes, extensions }` | diagnostics | `CarveOptionError` |
| `fix` | source, `{ rules, platforms, extensions }` | `{ output, applied }`, as `carve lint --fix` writes it ([Lint fixes](#lint-fixes)) | `CarveOptionError` |
| `fixEdits` | source, a diagnostic of `lint` | the edits that fix that finding, or null | `CarveOptionError` |
| `importDocument` | HTML, `{ from: 'html', rawHtml, strictLosses, allowLosses, maxLosses }` | `{ document, source, diagnostics }` | `CarveOptionError`, `ImportInputError` |
| `includeDependencies` | a tree, `{ ranges }` | its include dependencies; with `ranges`, each directive's byte range | |
| `includeRegion` | file text, a region name, `{ code }` | `{ ok, text, start, end }` or `{ ok: false, reason }` | `CarveOptionError` |
| `positionOf` | source, a UTF-8 byte offset | `{ line, column }` as the command line counts them (C2-T-041) | `CarveOptionError` |
| `headingId` | the plain text of a heading, `{ headingIds }` | the id the option generates, or null under `off` | `CarveOptionError` |
| `diffTree` | two trees | a JSON Patch (RFC 6902) over `encodeTree` | `CarveTreeError` |
| `applyPatch` | a tree, a patch, `{ fingerprint, extensions }` | the patched tree | `CarveOptionError`, `CarveTreeError`, `CarvePatchError` |
| `sourceFingerprint`, `treeFingerprint` | source, or a tree | `sha256:` and a hex hash | `CarveOptionError`, `CarveTreeError` |
| `encodeTree`, `encodeEnvelope` | a tree | JSON text | |
| `decodeTree` | JSON text, `{ extensions, source }` | the tree | `CarveOptionError`, `CarveTreeError` |
| `validateTree` | a value, `{ extensions }` | nothing | `CarveOptionError`, `CarveTreeError` |
| `migrateTree` | the JSON value of a 1.x or draft tree, `{ source }` | `{ document, envelope, layout, diagnostics }` | `CarveOptionError`, `CarveTreeError` |
| `validateLayout` | a sidecar value | the sidecar | `CarveLayoutError` |
| `writeDocument`, `createWriterRegistry` | a target name and a tree | `{ output, diagnostics }` | `CarveOptionError`, and the errors of the writer |

Helpers: `fixableRules` lists the lint rules that `fix` rewrites. `isUrlAllowed` and `urlScheme` test a URL against a
URL policy (for an extension renderer that writes a link), `DEFAULT_DENIED_SCHEMES` is the default deny list, `utf8Length` and `stringOffsetOfByte` turn the byte
ranges of diagnostics and positions into string offsets. `AST_VERSION`, `LAYOUT_VERSION` and `MAX_TREE_DEPTH` are
the contract constants. `VERSION` is the package version, `SPEC_VERSION` is `{ version: '0.2', commit }` with the
commit of the specification the engine pins, and `NODE_TYPES` holds the `block` and `inline` node type lists of the
pinned tree schema; the build writes all three. The node types (`DocumentNode`, `Block`, `Inline` and one interface per node) and the option
types are exported as types.

```ts
import { parse, render, renderWithDiagnostics } from '@markup-carve/carve'

const html = render('= Hello /Carve/', { headingIds: 'lower' })
if (!html.includes('<em>Carve</em>')) throw new Error(html)

const tree = parse('Some *strong* text.')
if (tree.children[0]?.type !== 'paragraph') throw new Error('no paragraph')

const result = renderWithDiagnostics('`x`{=latex}')
if (result.diagnostics[0]?.channel !== 'render-loss') throw new Error('no loss reported')
```

## Options and errors

### Soft breaks and losses

`softBreak` writes a soft break as a line break (`newline`, the default), one space (`space`), or `<br>` and a line
break (`br`), for output such as chat that shows no source line break (C2-H-203). `allowLosses` lists render-loss
codes the host accepts: they are left out of the diagnostics and never fail a `strictLosses` render (C2-H-204).
`maxLosses` keeps the first losses, 100 by default, and counts the rest in `suppressedDiagnostics` (C2-H-205).
`importDocument` reads `allowLosses` and `maxLosses` too.

```ts
import { render, renderWithDiagnostics } from '@markup-carve/carve'

if (render('a\nb', { softBreak: 'br' }) !== '<p>a<br>\nb</p>') throw new Error('softBreak')
const result = renderWithDiagnostics('[a](javascript:x)', { allowLosses: ['destination-denied'], strictLosses: true })
if (result.diagnostics.length !== 0 || result.html === '') throw new Error('allowLosses')
```

### Host code block renderer

`render` and `renderWithDiagnostics` accept an optional `codeBlockRenderer(node, defaultHtml)` callback.
It runs for every ordinary code block, including blocks inside containers and expanded includes. `node` supplies
the language in `syntax`, the source in `value`, and any `title`, `groupLabel` and `attrs`. Return HTML to replace
the block, or return `undefined` to use `defaultHtml`, which has already escaped the source and applied the normal
attributes. Any other result throws `CarveOptionError` naming `codeBlockRenderer`. The callback is trusted host code: its returned HTML is inserted unchanged. This is useful for a
syntax highlighter that emits a placeholder for languages it supports.

```ts
import { render } from '@markup-carve/carve'

const source = '```ts\nlet a = 1\n```\n'
const html = render(source, {
  codeBlockRenderer(node, defaultHtml) {
    return node.syntax === 'ts' ? '<pre data-highlighted="ts">placeholder</pre>' : defaultHtml
  },
})
```

Every option is checked before anything is parsed. An unknown name, a value of the wrong type, or an option of
another stage (`alignTables` on `render`) throws `CarveOptionError`, whose `option` names the option.

```ts
import { CarveOptionError, render } from '@markup-carve/carve'

try {
  render('text', { headingIds: 'upper' } as never)
  throw new Error('accepted')
} catch (error) {
  if (!(error instanceof CarveOptionError) || error.option !== 'headingIds') throw error
}
```

| Error | Thrown when | Command line category |
|---|---|---|
| `CarveOptionError` | an option has an unknown name or a bad value | `usage` |
| `CarveInputError` | the source is longer than its profile accepts | `input-invalid` |
| `CarveRenderError` | a render or import lost content under `strictLosses`; `diagnostics` holds the losses | `render-loss` |
| `CarveWriteError` | the writer cannot spell the tree; `diagnostics` holds the losses | `writer-refused` |
| `CarveTreeError` | a tree is not one of contract 2.0; `path` and `reason` say where | `ast-json-invalid` |
| `CarveLayoutError` | a sidecar is not valid | `ast-json-invalid` |
| `ImportInputError` | the importer cannot read the HTML | `import-input-invalid` |

A diagnostic is plain data: `code`, `severity`, `channel` (`parse`, `render-loss` or `lint`), `message`, and where
known `path` (an RFC 6901 pointer into the tree), `range` (UTF-8 byte offsets) and `file` (the included file).

## Includes

A parse expands include directives only when the `includes` option gives a resolver. The resolver is a function of
the request (`path`, `section`, `options`, `from`) that returns the text with an id, or one error: `not_found`,
`outside_root`, `unreadable` or `non_text`.

```ts
import { includeDependencies, parse, render } from '@markup-carve/carve'

const files: Record<string, string> = { 'chapter.crv': '= Chapter\n\nBody.\n' }
const resolver = ({ path }: { path: string }) =>
  Object.hasOwn(files, path) ? { text: files[path]!, id: path } : { error: 'not_found' as const }

const html = render('{{ chapter.crv }}', { includes: resolver })
if (!html.includes('Body.')) throw new Error(html)
const tree = parse('{{ chapter.crv }}', { includes: { resolver, file: 'main.crv', depth: 8 } })
if (includeDependencies(tree)[0]?.file !== 'chapter.crv') throw new Error('no dependency')
```

On Node, `fileSystemResolver(root, options)` from `@markup-carve/carve/node` reads files below `root`, as the
command line does. `maxFileBytes` makes a larger file `unreadable` (it can lower the 8 MiB cap, not raise it), and
`allowAbsolute: false` refuses an absolute include path with `outside_root`; by default an absolute path is read
when it lies inside the root (C2-N-012).

`includeRegion(text, name, { code })` gives the region an `@region:name` directive selects, for an editor that jumps
to it: the text, and its first and last line from 1. Where the directive would report `include-region-invalid`, the
result is `{ ok: false, reason }`. `includeDependencies(tree, { ranges: true })` adds the UTF-8 byte range of each
directive in its including file, where the tree has positions.

## Headings and positions

`headingId(text, { headingIds })` is the id that the `headingIds` option generates for a heading whose plain text is
`text`. Each call stands alone: it knows no other heading, so it never adds the `-2` suffix of a repeated id and never
avoids an authored one (C2-H-024). `positionOf(source, offset)` turns a UTF-8 byte offset into the line and column
the command line writes (C2-T-041); an offset inside a character is refused.

```ts
import { headingId, positionOf } from '@markup-carve/carve'

if (headingId('Hello World', { headingIds: 'lower' }) !== 'hello-world') throw new Error('headingId')
const place = positionOf('ä\nb', 3)
if (place.line !== 2 || place.column !== 1) throw new Error('positionOf')
```

## Tree diff and patch

`diffTree(a, b)` returns the JSON Patch (RFC 6902) that turns `encodeTree(a)` into `encodeTree(b)`. Its paths are
RFC 6901 pointers, as the `path` of a diagnostic is. `applyPatch(tree, patch, { fingerprint })` applies a patch and
decodes the result. It throws one `CarvePatchError`, with `path` and `reason`, when `fingerprint` is not
`treeFingerprint(tree)`, an operation fails (the path points into the patch), or the result is no tree (the path
points into the result). `sourceFingerprint` hashes a source the same way, so a host can bind a patch to the text it
came from. There is no reversible patch and no three-way merge. `carve diff [--json] a.crv b.crv` writes the patch
between two files, compared without positions.

```ts
import { applyPatch, diffTree, parse, treeFingerprint } from '@markup-carve/carve'

const before = parse('Some /old/ text.', { positions: false })
const after = parse('Some *new* text.', { positions: false })
const patch = diffTree(before, after)
const patched = applyPatch(before, patch, { fingerprint: treeFingerprint(before) })
if (diffTree(patched, after).length !== 0) throw new Error('patch')
```

## Upgrade

`upgrade(source, { edits })` from `@markup-carve/carve/upgrade` rewrites Carve 0.1 source into 0.2, as
`carve upgrade` does, and returns `output`, `changed`, `records` (the upgrade rows that applied), `check` and
`engine01`. With `edits: true` it also returns the changes from the input to the output, each with its UTF-8 byte
range, its replacement and its upgrade row, so an editor can offer them one at a time.

```js
import { upgrade } from '@markup-carve/carve/upgrade'

const result = upgrade('Some _it_ text.\n', { edits: true })
if (result.output !== 'Some {_it_} text.\n' || result.edits?.[0]?.entry !== 'U-065') throw new Error('upgrade')
```

## Lint fixes

`fix(source, options)` applies the fix pass of `carve lint --fix` (see [the CLI guide](cli.md)): each finding of a
rule in `fixableRules` becomes the one replacement its message names. Every fixable rule is on unless `rules` turns
it off, and a fix is kept only where its node stands at the finding after the rewrite. `applied` counts the fixes by
rule. Includes are not read: a fix rewrites only the source it is given, so `includes` is refused.

`fixEdits(source, diagnostic)` returns the edits for one finding of `lint(source)`: each has `startOffset` and
`endOffset` (UTF-8 bytes, as in the diagnostic) and the replacement `text`. It returns null where the rule has no
fix, or where the fix would not hold. Where two rules report one range with different replacements (`~x~` under
`djot-subscript-tilde` and `deprecated-bare-strike`), `fix` leaves the range as written, while `fixEdits` gives each
finding its own edits, so an editor can offer both choices.

```js
import { fix, fixEdits, lint } from '@markup-carve/carve'

const result = fix('**bold** and ~~strike~~\n')
if (result.output !== '*bold* and {~strike~}\n' || result.applied.get('markdown-strong-double-star') !== 1) throw new Error('fix')

const source = 'Some **bold** text.\n'
const finding = lint(source).find((entry) => entry.code === 'markdown-strong-double-star')
const edits = finding === undefined ? null : fixEdits(source, finding)
if (edits?.[0]?.text !== '*' || edits[0].startOffset !== 5) throw new Error('fixEdits')
```

## Prettier

`@markup-carve/carve/prettier` is a Prettier 3 plugin. It claims `.crv` files and prints them with `format`, so its
output is that of `carve fmt`; `carveAlignTables` and `carveNormalize` are the `alignTables` and `normalize` options.
Prettier itself turns line endings into line feeds before the plugin runs.

```json
{ "plugins": ["@markup-carve/carve/prettier"], "carveAlignTables": true }
```

## Writers

`writeDocument(target, tree, options)` writes a resolved tree with a built-in writer and returns
`{ output, diagnostics }`. The built-in targets are `html` (the options of `render`) and `carve` (the options of
`write`). Every writer reads `strictLosses`: with it on, a writer that loses content throws instead of returning.

`createWriterRegistry()` returns a registry that holds the built-in writers and takes more. A writer is an object
with a `target`, a lower-case name, and a `write(document, options)` function.

```ts
import { createWriterRegistry, parse, type Writer } from '@markup-carve/carve'

const shout: Writer = {
  target: 'shout',
  write: (document) => ({ output: JSON.stringify(document.children.length), diagnostics: [] }),
}
const writers = createWriterRegistry()
writers.register(shout)
if (writers.write('shout', parse('a\n\nb')).output !== '2') throw new Error('wrong count')
if (writers.write('carve', parse('a')).output !== 'a\n') throw new Error('carve writer')
```

The Markdown, plain-text and ANSI exports live in their own entry, `@markup-carve/carve/export` ([exports](export.md)).
Their targets `markdown`, `plain` and `ansi` are reserved (`RESERVED_WRITER_TARGETS`): `register` refuses them for any
other writer, and `registerExports` from that entry adds them to a registry.

## Extensions (provisional)

The extension surface may change in 0.2.x (`spec/0.2/extensions.md`): the `extensions` option registers
`ExtensionDefinition`s that claim divs, fences or inline extensions, and the `renderers` option maps an extension
name to an `ExtensionRenderer`, trusted host code whose HTML is inserted unchanged. `tabsExtensions` and
`tabsRenderer` are the standard tabs extension. More standard extensions come from `@markup-carve/carve/extensions`;
[fenced renderers](fenced-renderers.md) covers the diagram presets, `mathBlock`, `codeGroup` and `codeCallouts`,
[blocks and inline extensions](extensions-blocks-inline.md) the rest of the block and inline ones,
[the reference apparatus](extensions-reference.md) `glossary`, `index` and `citations`, and
[navigation](extensions-navigation.md) the table of contents, heading and link extensions. An `ExtensionDefinition` may
also carry a `documentTransform`, which runs on the render view (C2-X-053); the navigation extensions use it.

```ts
import { render, tabsExtensions, tabsRenderer } from '@markup-carve/carve'

const source = ':::: tabs\n::: tab "Install"\nRun.\n:::\n::::\n'
const html = render(source, { extensions: tabsExtensions, renderers: { 'carve.tabs': tabsRenderer } })
if (!html.includes('Install')) throw new Error(html)
```

## Migrating from 0.1

Each value the 0.1 package root exports, and what replaces it in 0.2. A row marked gone has no 0.2 call; the note
says what to use instead. Of the 172 values, 118 map to a 0.2 call and 54 are gone.

| 0.1 call | 0.2 call | Note |
|---|---|---|
| `parse`, `resolve` | `parse` | returns the resolved tree of contract 2.0 |
| `parseWithSourceLayout`, `toSourceLayout` | `parseWithLayout` | the layout sidecar is `result.layout` |
| `carveToHtml`, `renderHtml` | `render` | takes source or a tree |
| `carveToHtmlWithReport`, `renderHtmlWithReport` | `renderWithDiagnostics` | losses are entries of the `render-loss` channel |
| `renderDocument`, `renderDocumentWithReport` | `writeDocument` | or a registry from `createWriterRegistry` |
| `carveToCarve` | `format` |  |
| `carveToCarveWithReport` | `formatWithDiagnostics` |  |
| `renderCarve` | `write` |  |
| `renderCarveWithReport` | `writeWithDiagnostics` |  |
| `carveToMarkdown`, `carveToMarkdownWithReport`, `renderMarkdown`, `renderMarkdownWithReport` | `toMarkdown` (`@markup-carve/carve/export`) | one result with `output` and `diagnostics`; source goes through `parse` first; writer target `markdown` |
| `carveToPlainText`, `carveToPlainTextWithReport`, `renderPlainText`, `renderPlainTextWithReport` | `toPlainText` (`@markup-carve/carve/export`) | as above; writer target `plain` |
| `carveToAnsi`, `carveToAnsiWithReport`, `renderAnsi`, `renderAnsiWithReport` | `toAnsi` (`@markup-carve/carve/export`) | as above; writer target `ansi` |
| `carveToAstJson` | `encodeTree(parse(source))` |  |
| `toAstJson` | `encodeTree` |  |
| `toAstEnvelope` | `encodeEnvelope` |  |
| `fromAstJson`, `fromAstEnvelope` | `decodeTree` | reads a bare tree and an envelope |
| `AstJsonDepthError`, `AstJsonRootError`, `AstJsonRootFieldError`, `AstJsonUnknownFieldError`, `AstJsonMisplacedNodeTypeError`, `AstJsonUnknownNodeTypeError`, `AstJsonNodeTypeError`, `AstJsonPartitionError`, `AstJsonSchemaError`, `AstEnvelopeShapeError`, `AstEnvelopeVersionError`, `AstEnvelopeExtensionError`, `AstEnvelopeVocabularyError` | `CarveTreeError` | one error with `path` and `reason` |
| `MAX_AST_JSON_DEPTH`, `MAX_RENDER_DEPTH` | `MAX_TREE_DEPTH` |  |
| `AST_CONTRACT_VERSION` | `AST_VERSION` |  |
| `RenderLossError` | `CarveRenderError` | thrown under `strictLosses` |
| `ProfileViolationError` | `CarveRenderError`, `CarveInputError` | a profile loss under `strictLosses`, or a source over the profile length |
| `SourceUnspellableError` | `CarveWriteError` |  |
| `htmlToAst`, `htmlToCarve`, `migrateHtml` | `importDocument(html, { from: 'html' })` | `document` and `source` of the result |
| `HtmlImportLimitError` | `ImportInputError` |  |
| `lintCarve`, `lintAccessibility` | `lint` | accessibility rules are lint rules (`a11y/image-alt`) |
| `lintIncludes` | `lint(source, { includes })` |  |
| `expandIncludes` | `parse(source, { includes })` | a resolver; `fileSystemResolver` from `./node` reads files |
| `applyProfile`, `Profile` | the `profile` option |  |
| `LinkPolicy` | the `urlPolicy` option | `isUrlAllowed` tests one URL |
| `smartQuotes` | the `smartTypography` option with `smartQuotes` from `@markup-carve/carve/extensions` | `smartQuotes(options)` sets the quote glyphs of a locale |
| `details`, `spoiler`, `semanticSpan`, `listTable`, `colorSwatch`, `wikilinks`, `smartQuoteLocales`, `isSmartQuoteLocaleSupported`, `SMART_QUOTE_LOCALES`, `defaultAttributes`, `tabNormalize` | same names from `@markup-carve/carve/extensions` | provisional; see [blocks and inline extensions](extensions-blocks-inline.md) |
| `tabs` | `tabsExtensions`, `tabsRenderer` | provisional |
| `fencedRender`, `mermaid`, `d2`, `graphviz`, `wavedrom`, `abc`, `plantuml`, `vegaLite`, `chart`, `presets`, `mathBlock`, `codeGroup`, `codeCallouts` | same names from `@markup-carve/carve/extensions` | provisional; each returns `{ extensions, renderers }`, see [fenced renderers](fenced-renderers.md) |
| `glossary`, `index`, `citations` | same names from `@markup-carve/carve/extensions` | provisional; each returns `{ extensions, renderers, transforms }`, see [glossary, index and citations](extensions-reference.md) |
| `tableOfContents`, `tocPlacement`, `headingPermalinks`, `headingNumbers`, `headingLevelShift`, `externalLinks`, `autolink` | `@markup-carve/carve/extensions` | provisional; see [Standard extensions: navigation](extensions-navigation.md) |
| `parseWithProvenance`, `astNodePaths`, `readNodeIdentity`, `toNodeIdentity`, `readAnnotationRanges`, `toAnnotationRanges`, `readProvenance`, `toProvenance`, `toAuthoredProvenance`, `AstSidecarError` | gone | 0.2 has one sidecar, the source layout; a diagnostic names its node by an RFC 6901 `path` |
| `createEditorSession`, `EditorChangeError`, `tryRenderHtmlStreaming` | gone | no incremental session in 0.2; parse again |
| `diffAst`, `createAstPatch` | `diffTree` | a JSON Patch over the encoded tree |
| `applyAstPatch` | `applyPatch` | with `fingerprint` to bind the patch to its tree |
| `AstPatchError` | `CarvePatchError` | one error with `path` and `reason` |
| `sourceFingerprint` | `sourceFingerprint`, `treeFingerprint` | `sha256:` and a hex hash |
| `formatChanges`, `mergeAst`, `applyReversibleAstPatch`, `createReversibleAstPatch` | gone | no reversible patch and no three-way merge in 0.2; a host keeps the old tree to undo |
| `carveToCarvePatch`, `applySourcePatch`, `createSourcePatch` | gone | source patches are not part of 0.2; `upgrade` gives source edits for the upgrade |
| `carveToPreservationReport`, `assessTablePreservation`, `PreservationError` | gone | not part of 0.2 |
| `checkPortability`, `normalizeHtml` | gone | Djot portability checks are not part of 0.2 |
| `markdownToCarve`, `migrateMarkdown` | `importDocument(markdown, { from: 'gfm' })` of `@markup-carve/carve/import` | `from: 'markdown'` reads CommonMark without the GFM extensions; see [import.md](import.md) |
| `djotToCarve`, `migrateDjot` | `importDocument(djot, { from: 'djot' })` of `@markup-carve/carve/import` | through djot.js and the HTML importer |
| `bbcodeToCarve`, `migrateBbcode` | `importDocument(bbcode, { from: 'bbcode' })` of `@markup-carve/carve/import` | JavaScript only |
| `BbcodeInputTooLargeError`, `BBCODE_MAX_INPUT_LENGTH` | the same names of `@markup-carve/carve/import` | the error is an `ImportInputError` |
| `djotMigrationWarnings` | `lint` | the `djot-` and `markdown-` lint rules report the collisions; the `djot-` rules are off unless `rules` turns them on |
| `applyMigrationFixes` | `fix` | `fixEdits` returns the edits of one finding |
| `renderCarveWithConversionReport`, `formatMigrationWarnings`, `BbcodeSentinelSpaceExhaustedError` | gone | the importers return `diagnostics`; the BBCode reader needs no sentinel characters |
| `SPEC_VERSION` | `SPEC_VERSION` | `{ version: '0.2', commit }` |
| `migrateCaseOnlyReferences` | `upgrade` (`./upgrade`) | the source upgrade covers it |
| `stampCarve`, `buildMarker`, `stripTrailingMarker`, `readStamp`, `needsReview`, `compareSpecVersions` | gone | 0.2 source carries no version stamp; `SPEC_VERSION` names what the engine reads |
| `formatLintWarnings`, `KNOWN_LINT_PLATFORMS` | gone | a diagnostic is plain data; the one platform is `github` |
| `inspectColonFences`, `decisionTrace`, `decisionTraceJsonLines` | gone | 0.1 debugging helpers; 0.2 has one parser path and no trace to show |
| `selectIncludeRegion` | `includeRegion` | returns the text and the lines |
| `findDirectiveSites` | `includeDependencies(tree, { ranges: true })` | the byte range of each directive |
| `headingReference` | `headingId` | the id without document dedup |
| `expandsForTarget`, `isDirectiveShape`, `parseDirective` | gone | include internals; a directive is an `include` node of the tree |
| `CANONICAL_BLOCK_TYPES`, `CANONICAL_INLINE_TYPES` | `NODE_TYPES` | `block` and `inline`, from the pinned schema |
| `LIB_VERSION` | `VERSION` | |
| `canonicalType`, `FOLDED_NODE_TYPES`, `CORE_AST_VOCABULARY` | gone | 0.2 has no folded or aliased types; the `Block` and `Inline` unions are the vocabulary |
| `CANONICAL_ADMONITION_KINDS`, `GENERATED_CONTENT_KINDS`, `SMART_PUNCTUATION_GLYPHS` | gone | fixed tables of the specification data, not of the API |
| `formatProfileViolation`, `RenderDepthError` | gone | a profile loss is a diagnostic; a too deep tree is a `CarveTreeError` |
| `imgFence`, `sanitizeSvg` | gone | 0.1 extensions; a host registers its own through the provisional `extensions` and `renderers` options |
| `fileSystemResolver` (`./node`) | `fileSystemResolver` (`./node`) | takes the root directory and `{ maxFileBytes, allowAbsolute }` |
| `DEFAULT_MAX_FILE_BYTES` (`./node`) | the `maxFileBytes` option of `fileSystemResolver`, the `bytes` field of the `includes` option | may be lowered, not raised |
| `./prettier` | `./prettier` | a plugin on `format` |
