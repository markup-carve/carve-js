# Carve 0.2 library API

`@markup-carve/carve/v2` is the public API of the Carve 0.2 engine. It follows the library calls of
`spec/0.2/tooling.md` (C2-T-005) and refuses with the typed errors of C2-T-040. The package root
(`@markup-carve/carve`) stays the 0.1 API, so a host that imports it today is unaffected; a host moves to
0.2 by changing the import path and the calls below.

| Entry | Runs in | Holds |
|---|---|---|
| `@markup-carve/carve/v2` | browsers, Node, Deno, bundlers (Vite, webpack, Astro, Obsidian) | every call below |
| `@markup-carve/carve/v2/node` | Node | `fileSystemResolver`, the include resolver that reads files |

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
| `importDocument` | HTML, `{ from: 'html', rawHtml, strictLosses }` | `{ document, source, diagnostics }` | `CarveOptionError`, `ImportInputError` |
| `includeDependencies` | a tree | its include dependencies | |
| `encodeTree`, `encodeEnvelope` | a tree | JSON text | |
| `decodeTree` | JSON text, `{ extensions, source }` | the tree | `CarveOptionError`, `CarveTreeError` |
| `validateTree` | a value, `{ extensions }` | nothing | `CarveOptionError`, `CarveTreeError` |
| `migrateTree` | the JSON value of a 1.x or draft tree, `{ source }` | `{ document, envelope, layout, diagnostics }` | `CarveOptionError`, `CarveTreeError` |
| `validateLayout` | a sidecar value | the sidecar | `CarveLayoutError` |
| `writeDocument`, `createWriterRegistry` | a target name and a tree | `{ output, diagnostics }` | `CarveOptionError`, and the errors of the writer |

Helpers: `isUrlAllowed` and `urlScheme` test a URL against a URL policy (for an extension renderer that writes
a link), `DEFAULT_DENIED_SCHEMES` is the default deny list, `utf8Length` and `stringOffsetOfByte` turn the byte
ranges of diagnostics and positions into string offsets. `AST_VERSION`, `LAYOUT_VERSION` and `MAX_TREE_DEPTH` are
the contract constants. The node types (`DocumentNode`, `Block`, `Inline` and one interface per node) and the option
types are exported as types.

```ts
import { parse, render, renderWithDiagnostics } from '@markup-carve/carve/v2'

const html = render('= Hello /Carve/', { headingIds: 'lower' })
if (!html.includes('<em>Carve</em>')) throw new Error(html)

const tree = parse('Some *strong* text.')
if (tree.children[0]?.type !== 'paragraph') throw new Error('no paragraph')

const result = renderWithDiagnostics('`x`{=latex}')
if (result.diagnostics[0]?.channel !== 'render-loss') throw new Error('no loss reported')
```

## Options and errors

### Host code block renderer

`render` and `renderWithDiagnostics` accept an optional `codeBlockRenderer(node, defaultHtml)` callback.
It runs for every ordinary code block, including blocks inside containers and expanded includes. `node` supplies
the language in `syntax`, the source in `value`, and any `title`, `groupLabel` and `attrs`. Return HTML to replace
the block, or return `undefined` to use `defaultHtml`, which has already escaped the source and applied the normal
attributes. The callback is trusted host code: its returned HTML is inserted unchanged. This is useful for a
syntax highlighter that emits a placeholder for languages it supports.

```ts
import { render } from '@markup-carve/carve/v2'

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
import { CarveOptionError, render } from '@markup-carve/carve/v2'

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
import { includeDependencies, parse, render } from '@markup-carve/carve/v2'

const files: Record<string, string> = { 'chapter.crv': '= Chapter\n\nBody.\n' }
const resolver = ({ path }: { path: string }) =>
  Object.hasOwn(files, path) ? { text: files[path]!, id: path } : { error: 'not_found' as const }

const html = render('{{ chapter.crv }}', { includes: resolver })
if (!html.includes('Body.')) throw new Error(html)
const tree = parse('{{ chapter.crv }}', { includes: { resolver, file: 'main.crv', depth: 8 } })
if (includeDependencies(tree)[0]?.file !== 'chapter.crv') throw new Error('no dependency')
```

On Node, `fileSystemResolver(root)` from `@markup-carve/carve/v2/node` reads files below `root`, as the command
line does.

## Writers

`writeDocument(target, tree, options)` writes a resolved tree with a built-in writer and returns
`{ output, diagnostics }`. The built-in targets are `html` (the options of `render`) and `carve` (the options of
`write`). Every writer reads `strictLosses`: with it on, a writer that loses content throws instead of returning.

`createWriterRegistry()` returns a registry that holds the built-in writers and takes more. A writer is an object
with a `target`, a lower-case name, and a `write(document, options)` function.

```ts
import { createWriterRegistry, parse, type Writer } from '@markup-carve/carve/v2'

const shout: Writer = {
  target: 'shout',
  write: (document) => ({ output: JSON.stringify(document.children.length), diagnostics: [] }),
}
const writers = createWriterRegistry()
writers.register(shout)
if (writers.write('shout', parse('a\n\nb')).output !== '2') throw new Error('wrong count')
if (writers.write('carve', parse('a')).output !== 'a\n') throw new Error('carve writer')
```

The Markdown, plain-text and ANSI writers of 0.1 are being ported to the 0.2 tree. They will arrive as the built-in
targets `markdown`, `plain-text` and `ansi` behind this same interface; those names are reserved
(`RESERVED_WRITER_TARGETS`), and `register` refuses them.

## Extensions (provisional)

The extension surface may change in 0.2.x (`spec/0.2/extensions.md`): the `extensions` option registers
`ExtensionDefinition`s that claim divs, fences or inline extensions, and the `renderers` option maps an extension
name to an `ExtensionRenderer`, trusted host code whose HTML is inserted unchanged. `tabsExtensions` and
`tabsRenderer` are the standard tabs extension.

```ts
import { render, tabsExtensions, tabsRenderer } from '@markup-carve/carve/v2'

const source = ':::: tabs\n::: tab "Install"\nRun.\n:::\n::::\n'
const html = render(source, { extensions: tabsExtensions, renderers: { 'carve.tabs': tabsRenderer } })
if (!html.includes('Install')) throw new Error(html)
```

## Migrating from 0.1

Each value the 0.1 package root exports, and what replaces it in 0.2. A row marked gone has no 0.2 call; the note
says what to use instead. Of the 172 values, 63 map to a 0.2 call and 109 are gone.

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
| `carveToMarkdown`, `carveToMarkdownWithReport`, `renderMarkdown`, `renderMarkdownWithReport` | writer target `markdown` | reserved; the writer is being ported |
| `carveToPlainText`, `carveToPlainTextWithReport`, `renderPlainText`, `renderPlainTextWithReport` | writer target `plain-text` | reserved; the writer is being ported |
| `carveToAnsi`, `carveToAnsiWithReport`, `renderAnsi`, `renderAnsiWithReport` | writer target `ansi` | reserved; the writer is being ported |
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
| `expandIncludes` | `parse(source, { includes })` | a resolver; `fileSystemResolver` from `./v2/node` reads files |
| `applyProfile`, `Profile` | the `profile` option |  |
| `LinkPolicy` | the `urlPolicy` option | `isUrlAllowed` tests one URL |
| `smartQuotes` | the `smartTypography` option |  |
| `tabs` | `tabsExtensions`, `tabsRenderer` | provisional |
| `parseWithProvenance`, `astNodePaths`, `readNodeIdentity`, `toNodeIdentity`, `readAnnotationRanges`, `toAnnotationRanges`, `readProvenance`, `toProvenance`, `toAuthoredProvenance`, `AstSidecarError` | gone | 0.2 has one sidecar, the source layout; a diagnostic names its node by an RFC 6901 `path` |
| `createEditorSession`, `EditorChangeError`, `tryRenderHtmlStreaming` | gone | no incremental session in 0.2; parse again |
| `diffAst`, `formatChanges`, `mergeAst`, `applyAstPatch`, `applyReversibleAstPatch`, `createAstPatch`, `createReversibleAstPatch`, `AstPatchError` | gone | AST diff, merge and patch are not part of 0.2 |
| `carveToCarvePatch`, `applySourcePatch`, `createSourcePatch`, `sourceFingerprint` | gone | source patches are not part of 0.2 |
| `carveToPreservationReport`, `assessTablePreservation`, `PreservationError` | gone | not part of 0.2 |
| `checkPortability`, `normalizeHtml` | gone | Djot portability checks are not part of 0.2 |
| `renderCarveWithConversionReport`, `markdownToCarve`, `djotToCarve`, `migrateMarkdown`, `migrateDjot`, `djotMigrationWarnings`, `formatMigrationWarnings`, `applyMigrationFixes`, `bbcodeToCarve`, `migrateBbcode`, `BbcodeInputTooLargeError`, `BbcodeSentinelSpaceExhaustedError`, `BBCODE_MAX_INPUT_LENGTH` | gone | Markdown, GFM and Djot import is outside the specification (C2-T-003): `carve2 import --from markdown`; BBCode is not carried over |
| `migrateCaseOnlyReferences`, `stampCarve`, `buildMarker`, `stripTrailingMarker`, `readStamp`, `needsReview`, `compareSpecVersions`, `SPEC_VERSION` | gone | 0.1 to 0.2 source upgrades run in `carve2 upgrade` |
| `formatLintWarnings`, `KNOWN_LINT_PLATFORMS` | gone | a diagnostic is plain data; the one platform is `github` |
| `inspectColonFences`, `decisionTrace`, `decisionTraceJsonLines`, `tabNormalize` | gone | 0.1 debugging helpers |
| `expandsForTarget`, `findDirectiveSites`, `selectIncludeRegion`, `isDirectiveShape`, `parseDirective`, `headingReference` | gone | include internals; `includeDependencies` lists what a tree includes |
| `defaultAttributes`, `canonicalType`, `CANONICAL_BLOCK_TYPES`, `CANONICAL_INLINE_TYPES`, `FOLDED_NODE_TYPES`, `CORE_AST_VOCABULARY`, `CANONICAL_ADMONITION_KINDS`, `GENERATED_CONTENT_KINDS`, `SMART_PUNCTUATION_GLYPHS`, `formatProfileViolation`, `RenderDepthError`, `LIB_VERSION` | gone | the node types are the `Block` and `Inline` unions; read the version from `package.json` |
| `details`, `semanticSpan`, `listTable`, `glossary`, `headingNumbers`, `codeCallouts`, `smartQuoteLocales`, `isSmartQuoteLocaleSupported`, `SMART_QUOTE_LOCALES`, `index`, `citations`, `fencedRender`, `mermaid`, `d2`, `graphviz`, `wavedrom`, `abc`, `plantuml`, `vegaLite`, `chart`, `presets`, `imgFence`, `sanitizeSvg`, `mathBlock`, `spoiler`, `colorSwatch`, `wikilinks`, `autolink`, `externalLinks`, `tableOfContents`, `tocPlacement`, `headingPermalinks`, `codeGroup`, `headingLevelShift` | gone | 0.1 extensions; a host registers its own through the provisional `extensions` and `renderers` options |
| `fileSystemResolver` (`./node`) | `fileSystemResolver` (`./v2/node`) | takes the root directory |
| `DEFAULT_MAX_FILE_BYTES` (`./node`) | the `bytes` field of the `includes` option | may be lowered, not raised |
| `./prettier` | gone | no 0.2 Prettier plugin yet |
