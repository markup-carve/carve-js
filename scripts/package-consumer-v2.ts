// The consumer of the packed 0.2 entries (scripts/check-package.mjs): every value is called once, as a host would.
import * as carve from '@markup-carve/carve/v2'
import {
  AST_VERSION, CarveInputError, CarveLayoutError, CarveOptionError, CarveRenderError, CarveTreeError, CarveWriteError,
  createWriterRegistry, decodeTree, DEFAULT_DENIED_SCHEMES, encodeEnvelope, encodeTree, format, formatWithDiagnostics,
  importDocument, ImportInputError, includeDependencies, isUrlAllowed, LAYOUT_VERSION, lint, MAX_TREE_DEPTH, migrateTree,
  parse, parseWithDiagnostics, parseWithLayout, render, RESERVED_WRITER_TARGETS, renderWithDiagnostics,
  renderWithDocumentTransforms, stringOffsetOfByte,
  tabsExtensions, tabsRenderer, urlScheme, utf8Length, validateLayout, validateTree, write, writeDocument,
  writeWithDiagnostics, type DocumentNode, type IncludeResolver, type Writer,
} from '@markup-carve/carve/v2'
import { fileSystemResolver } from '@markup-carve/carve/v2/node'

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

refuses(() => render('a', { headingIds: 'upper' } as never), CarveOptionError, 'CarveOptionError')
refuses(() => render('x'.repeat(10_001), { profile: 'minimal' }), CarveInputError, 'CarveInputError')
refuses(() => render(raw, { strictLosses: true }), CarveRenderError, 'CarveRenderError')
refuses(() => decodeTree('{'), CarveTreeError, 'CarveTreeError')
refuses(() => validateLayout({}), CarveLayoutError, 'CarveLayoutError')
refuses(() => importDocument(1 as never, { from: 'html' }), ImportInputError, 'ImportInputError')
check(typeof CarveWriteError === 'function', 'CarveWriteError')
check(typeof fileSystemResolver('.') === 'function', 'fileSystemResolver')
check(Object.keys(carve).length === 39, `the 0.2 entry exports ${Object.keys(carve).length} values`)
