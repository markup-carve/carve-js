// The consumer of the packed 0.2 entries (scripts/check-package.mjs): every value is called once, as a host would.
import * as carve from '@markup-carve/carve'
import {
  AST_VERSION, CarveInputError, CarveLayoutError, CarveOptionError, CarveRenderError, CarveTreeError, CarveWriteError,
  createWriterRegistry, decodeTree, DEFAULT_DENIED_SCHEMES, encodeEnvelope, encodeTree, format, formatWithDiagnostics,
  importDocument, ImportInputError, includeDependencies, isUrlAllowed, LAYOUT_VERSION, lint, MAX_TREE_DEPTH, migrateTree,
  parse, parseWithDiagnostics, parseWithLayout, render, RESERVED_WRITER_TARGETS, renderWithDiagnostics,
  renderWithDocumentTransforms, stringOffsetOfByte,
  tabsExtensions, tabsRenderer, urlScheme, utf8Length, validateLayout, validateTree, write, writeDocument,
  writeWithDiagnostics, type DocumentNode, type IncludeResolver, type Writer,
} from '@markup-carve/carve'
import { fileSystemResolver } from '@markup-carve/carve/node'
import { BBCODE_MAX_INPUT_LENGTH, BbcodeInputTooLargeError, importDocument as importFormat } from '@markup-carve/carve/import'
import * as prettierPlugin from '@markup-carve/carve/prettier'
import { upgrade } from '@markup-carve/carve/upgrade'
import { tableOfContents, tocRenderers } from '@markup-carve/carve/extensions'

function check(ok: boolean, what: string): void {
  if (!ok) throw new Error(what)
}

function refuses(run: () => unknown, type: new (...args: never[]) => Error, what: string): void {
  try {
    run()
  } catch (error) {
    check(error instanceof type, what)
    return
  }
  throw new Error(`${what}: not refused`)
}

const files: Record<string, string> = { 'part.crv': 'Part.\n' }
const resolver: IncludeResolver = ({ path }) =>
  Object.hasOwn(files, path) ? { text: files[path]!, id: path } : { error: 'not_found' }
const tree: DocumentNode = parse('= Title\n\n{{ part.crv }}', { includes: resolver })
const raw = '`x`{=latex}'

check(tree.astVersion === AST_VERSION, 'parse')
check(parseWithDiagnostics('a').suppressedDiagnostics === 0, 'parseWithDiagnostics')
check(validateLayout(JSON.parse(JSON.stringify(parseWithLayout('a').layout))).version === LAYOUT_VERSION, 'parseWithLayout')
check(render('a /b/') === '<p>a <em>b</em></p>', 'render')
check(renderWithDiagnostics(raw).diagnostics.length === 1, 'renderWithDiagnostics')
check(renderWithDocumentTransforms('a', []).html === '<p>a</p>', 'renderWithDocumentTransforms')
check(format('a') === 'a\n' && formatWithDiagnostics('a').source === 'a\n', 'format')
check(write(parse('a')) === 'a\n' && writeWithDiagnostics(parse('a')).source === 'a\n', 'write')
check(lint('![](a.png)').length > 0, 'lint')
check(importDocument('<p>a</p>', { from: 'html' }).source === 'a\n', 'importDocument')
check(importFormat('# a *b*', { from: 'gfm' }).source === '= a /b/\n', 'import entry: gfm')
check(importFormat('_a_', { from: 'djot' }).source === '/a/\n', 'import entry: djot')
check(importFormat('[b]a[/b]', { from: 'bbcode' }).source === '*a*\n', 'import entry: bbcode')
refuses(() => importFormat('x'.repeat(BBCODE_MAX_INPUT_LENGTH + 1), { from: 'bbcode' }), BbcodeInputTooLargeError,
  'BbcodeInputTooLargeError')
check(includeDependencies(tree)[0]?.read === true, 'includeDependencies')
check(decodeTree(encodeTree(tree)).children.length === tree.children.length, 'encodeTree')
check(decodeTree(encodeEnvelope(tree)).children.length === tree.children.length, 'encodeEnvelope')
validateTree(tree)
check(migrateTree({ type: 'document', children: [] }).document.astVersion === AST_VERSION, 'migrateTree')

const stub: Writer = { target: 'count', write: (document) => ({ output: String(document.children.length), diagnostics: [] }) }
const writers = createWriterRegistry()
writers.register(stub)
check(writers.write('count', tree).output === String(tree.children.length), 'writer registry')
check(writeDocument('carve', parse('a')).output === 'a\n', 'writeDocument')
check(RESERVED_WRITER_TARGETS.includes('markdown'), 'reserved targets')

check(!isUrlAllowed('javascript:x') && urlScheme('HTTP://a') === 'http' && DEFAULT_DENIED_SCHEMES.length > 0, 'url helpers')
check(utf8Length('ä') === 2 && stringOffsetOfByte('äb', 2) === 1, 'positions')
check(MAX_TREE_DEPTH > 0, 'MAX_TREE_DEPTH')
const tabs = ':::: tabs\n::: tab "A"\nB\n:::\n::::\n'
check(render(tabs, { extensions: tabsExtensions, renderers: { 'carve.tabs': tabsRenderer } }).includes('A'), 'tabs')
check(render('= A\n', { extensions: [tableOfContents()], renderers: tocRenderers }).startsWith('<nav class="toc"'), 'extensions entry')

refuses(() => render('a', { headingIds: 'upper' } as never), CarveOptionError, 'CarveOptionError')
refuses(() => render('x'.repeat(10_001), { profile: 'minimal' }), CarveInputError, 'CarveInputError')
refuses(() => render(raw, { strictLosses: true }), CarveRenderError, 'CarveRenderError')
refuses(() => decodeTree('{'), CarveTreeError, 'CarveTreeError')
refuses(() => validateLayout({}), CarveLayoutError, 'CarveLayoutError')
refuses(() => importDocument(1 as never, { from: 'html' }), ImportInputError, 'ImportInputError')
check(typeof CarveWriteError === 'function', 'CarveWriteError')
check(typeof fileSystemResolver('.') === 'function', 'fileSystemResolver')
check(Object.keys(carve).length === 53, `the 0.2 entry exports ${Object.keys(carve).length} values`)
check(carve.VERSION.length > 0 && carve.SPEC_VERSION.version === '0.2' && carve.NODE_TYPES.inline.includes('text'), 'constants')
const before = parse('a')
const after = parse('b')
check(carve.diffTree(carve.applyPatch(before, carve.diffTree(before, after)), after).length === 0, 'diffTree, applyPatch')
check(carve.positionOf('a\nb', 2).line === 2 && carve.headingId('A b') === 'A-b', 'positionOf, headingId')
check(upgrade('_a_\n', { edits: true }).edits !== undefined, 'upgrade entry')
check(prettierPlugin.parsers.carve.astFormat === 'carve-source', 'prettier entry')
