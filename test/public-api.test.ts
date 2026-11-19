import { mkdirSync, mkdtempSync, readFileSync, realpathSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { describe, expect, it } from 'vitest'
import * as api from '../public/index.ts'
import { fileSystemResolver } from '../public/node.ts'
import {
  AST_VERSION, CarveInputError, CarveLayoutError, CarveOptionError, CarveRenderError, CarveTreeError, CarveWriteError,
  createWriterRegistry, decodeTree, DEFAULT_DENIED_SCHEMES, encodeEnvelope, encodeTree, format, formatWithDiagnostics,
  importDocument, ImportInputError, includeDependencies, isUrlAllowed, LAYOUT_VERSION, lint, MAX_TREE_DEPTH, migrateTree,
  parse, parseWithDiagnostics, parseWithLayout, render, RESERVED_WRITER_TARGETS, renderWithDiagnostics, stringOffsetOfByte,
  tabsExtensions, tabsRenderer, urlScheme, utf8Length, validateLayout, validateTree, write, writeDocument, type Writer,
  writeWithDiagnostics,
} from '../public/index.ts'

const root = join(import.meta.dirname, '..')

function refusal(run: () => unknown): unknown {
  try {
    run()
  } catch (error) {
    return error
  }
  throw new Error('the call was not refused')
}

function optionError(run: () => unknown, option: string): void {
  const error = refusal(run)
  expect(error).toBeInstanceOf(CarveOptionError)
  expect((error as CarveOptionError).option).toBe(option)
}

describe('the public 0.2 entry', () => {
  it('exports exactly the public values', () => {
    expect(Object.keys(api).sort()).toEqual([
      'AST_VERSION', 'CarveInputError', 'CarveLayoutError', 'CarveOptionError', 'CarveRenderError', 'CarveTreeError',
      'CarveWriteError', 'DEFAULT_DENIED_SCHEMES', 'ImportInputError', 'LAYOUT_VERSION', 'MAX_TREE_DEPTH',
      'RESERVED_WRITER_TARGETS', 'createWriterRegistry', 'decodeTree', 'encodeEnvelope', 'encodeTree', 'format',
      'formatWithDiagnostics', 'importDocument', 'includeDependencies', 'isUrlAllowed', 'lint', 'migrateTree', 'parse',
      'parseWithDiagnostics', 'parseWithLayout', 'render', 'renderWithDiagnostics', 'renderWithDocumentTransforms', 'stringOffsetOfByte', 'tabsExtensions',
      'tabsRenderer', 'urlScheme', 'utf8Length', 'validateLayout', 'validateTree', 'write', 'writeDocument',
      'writeWithDiagnostics',
    ].sort())
  })

  it('parses, with diagnostics and with the layout sidecar', () => {
    expect(parse('= Title').children[0]?.type).toBe('heading')
    expect(parse('a', { positions: false }).children[0]?.pos).toBeUndefined()
    const result = parseWithDiagnostics('[a][missing]')
    expect(result.suppressedDiagnostics).toBe(0)
    expect(result.diagnostics.every((entry) => entry.channel === 'parse')).toBe(true)
    const layout = parseWithLayout('- a\n- b\n')
    expect(layout.layout.version).toBe(LAYOUT_VERSION)
    expect(validateLayout(JSON.parse(JSON.stringify(layout.layout)))).toEqual(layout.layout)
    optionError(() => parse('a', { sourceLines: true } as never), 'sourceLines')
    optionError(() => parse('a', { headingIds: 'upper' } as never), 'headingIds')
  })

  it('renders source, bytes and trees', () => {
    expect(render('a /b/')).toBe('<p>a <em>b</em></p>')
    expect(render(new TextEncoder().encode('a'))).toBe('<p>a</p>')
    expect(render(parse('a'))).toBe('<p>a</p>')
    const result = renderWithDiagnostics('`x`{=latex}')
    expect(result.diagnostics.map((entry) => entry.channel)).toEqual(['render-loss'])
    expect(refusal(() => render('`x`{=latex}', { strictLosses: true }))).toBeInstanceOf(CarveRenderError)
    expect(refusal(() => render('x'.repeat(10_001), { profile: 'minimal' }))).toBeInstanceOf(CarveInputError)
    optionError(() => render('a', { alignTables: true } as never), 'alignTables')
    optionError(() => render('a', { urlPolicy: { block: [] } } as never), 'urlPolicy')
    optionError(() => renderWithDiagnostics('a', { smartTypography: 'yes' } as never), 'smartTypography')
  })

  it('formats and writes canonical source', () => {
    expect(format('*a*')).toBe('*a*\n')
    expect(formatWithDiagnostics('a').diagnostics).toEqual([])
    expect(write(parse('= A'))).toBe('= A\n')
    expect(writeWithDiagnostics(parse('a'), { alignTables: true, check: false }).source).toBe('a\n')
    optionError(() => format('a', { headingIds: 'lower' } as never), 'headingIds')
    optionError(() => write(parse('a'), { normalize: true } as never), 'normalize')
    optionError(() => write(parse('a'), { alignTables: 1 } as never), 'alignTables')
    optionError(() => writeWithDiagnostics(parse('a'), { layout: [] } as never), 'layout')
    for (const nodes of [[null], [{}], ['x'], [{ path: '', wraps: [{}] }], [{ path: '', bare: 'yes' }]]) {
      optionError(() => write(parse('a'), { layout: { nodes } } as never), 'layout')
      optionError(() => writeDocument('carve', parse('a'), { layout: { nodes } }), 'layout')
    }
    const sidecar = parseWithLayout('a\nb\n')
    expect(write(sidecar.document, { layout: sidecar.layout })).toBe('a\nb\n')
    optionError(() => write(parse('a'), { extensions: [{}] } as never), 'extensions')
    expect(refusal(() => write({ type: 'document' } as never))).toBeInstanceOf(CarveTreeError)
    const unspellable = { type: 'document', astVersion: AST_VERSION, children: [{ type: 'paragraph', children: [
      { type: 'text', value: 'a' }, { type: 'text', value: 'b' }] }] }
    const written = writeWithDiagnostics(unspellable as never)
    if (written.diagnostics.some((entry) => entry.code === 'writer-refused' || entry.code.endsWith('-unspellable'))) {
      expect(refusal(() => write(unspellable as never))).toBeInstanceOf(CarveWriteError)
    }
  })

  it('lints with rules and platforms', () => {
    const findings = lint('![](a.png)')
    expect(findings.some((entry) => entry.code === 'a11y/image-alt' && entry.channel === 'lint')).toBe(true)
    expect(lint('![](a.png)', { rules: { 'a11y/image-alt': 'off' } }).some((entry) => entry.code === 'a11y/image-alt')).toBe(false)
    optionError(() => lint('a', { rules: { nope: 'on' } } as never), 'rules')
    optionError(() => lint('a', { profile: 'full' } as never), 'profile')
  })

  it('imports HTML', () => {
    const result = importDocument('<h1>Title</h1><p>Some <em>text</em>.</p>', { from: 'html' })
    expect(result.source).toBe('= Title\n\nSome /text/.\n')
    expect(result.document.children[0]?.type).toBe('heading')
    expect(importDocument('<!-- c --><p>a</p>', { from: 'html', rawHtml: true }).document.children.length).toBe(2)
    optionError(() => importDocument('<p>a</p>', { from: 'markdown' } as never), 'from')
    optionError(() => importDocument('<p>a</p>', undefined as never), 'from')
    optionError(() => importDocument('<p>a</p>', { from: 'html', raw: true } as never), 'raw')
    optionError(() => importDocument('<p>a</p>', { from: 'html', strictLosses: 'yes' } as never), 'strictLosses')
    expect(refusal(() => importDocument(1 as never, { from: 'html' }))).toBeInstanceOf(ImportInputError)
    const deep = `${'<div>'.repeat(MAX_TREE_DEPTH + 10)}a`
    expect(refusal(() => importDocument(deep, { from: 'html' }))).toBeInstanceOf(ImportInputError)
  })

  it('expands includes through a resolver and lists the dependencies', () => {
    const files: Record<string, string> = { 'part.crv': 'Included.\n' }
    const resolver = ({ path }: { path: string }) =>
      Object.hasOwn(files, path) ? { text: files[path]!, id: path } : { error: 'not_found' as const }
    expect(render('{{ part.crv }}', { includes: resolver })).toContain('Included.')
    const tree = parse('{{ part.crv }}\n\n{{ gone.crv }}', { includes: { resolver, file: 'main.crv' } })
    expect(includeDependencies(tree).map((entry) => [entry.path, entry.read])).toEqual([['part.crv', true], ['gone.crv', false]])
    expect(parseWithDiagnostics('{{ part.crv }}').diagnostics.map((entry) => entry.code)).toEqual(['include-no-resolver'])
    optionError(() => parse('a', { includes: { resolver, depth: 99 } }), 'includes')
    optionError(() => parse('a', { includes: 'root' } as never), 'includes')
  })

  it('reads files below a root with the Node resolver', () => {
    const dir = realpathSync(mkdtempSync(join(tmpdir(), 'carve-public-')))
    mkdirSync(join(dir, 'docs'))
    writeFileSync(join(dir, 'docs/part.crv'), 'From disk.\n')
    const resolver = fileSystemResolver(dir)
    expect(render('{{ docs/part.crv }}', { includes: resolver })).toContain('From disk.')
    expect(resolver({ path: '../outside.crv', options: {} })).toEqual({ error: 'outside_root' })
    expect(resolver({ path: 'docs/none.crv', options: {} })).toEqual({ error: 'not_found' })
  })

  it('encodes, decodes, validates and migrates trees', () => {
    const tree = parse('a *b*')
    expect(decodeTree(encodeTree(tree))).toEqual(tree)
    expect(decodeTree(encodeEnvelope(tree))).toEqual(tree)
    expect((JSON.parse(encodeEnvelope(tree)) as { document: { type: string } }).document.type).toBe('document')
    expect(refusal(() => decodeTree('{'))).toBeInstanceOf(CarveTreeError)
    optionError(() => decodeTree(encodeTree(tree), { strict: true } as never), 'strict')
    optionError(() => decodeTree(1 as never), 'json')
    validateTree(tree)
    validateTree(tree, { extensions: [] })
    const invalid = refusal(() => validateTree({ type: 'document', children: [] }))
    expect(invalid).toBeInstanceOf(CarveTreeError)
    optionError(() => validateTree(tree, { extensions: 'none' } as never), 'extensions')
    expect(refusal(() => validateLayout({}))).toBeInstanceOf(CarveLayoutError)
    const migrated = migrateTree({ type: 'document', children: [{ type: 'paragraph', children: [{ type: 'text', value: 'a' }] }] })
    expect(migrated.document.children.map((node) => node.type)).toEqual(['paragraph'])
    expect(migrated.document.astVersion).toBe(AST_VERSION)
    expect(refusal(() => migrateTree({ type: 'doc' }))).toBeInstanceOf(CarveTreeError)
    optionError(() => migrateTree({}, { strict: true } as never), 'strict')
  })

  it('answers URL and position questions', () => {
    expect(urlScheme('JavaScript:alert(1)')).toBe('javascript')
    expect(isUrlAllowed('javascript:alert(1)')).toBe(false)
    expect(isUrlAllowed('https://example.org')).toBe(true)
    expect(isUrlAllowed('ftp://a', { allow: ['https'] })).toBe(false)
    expect(DEFAULT_DENIED_SCHEMES).toContain('javascript')
    expect(utf8Length('äb')).toBe(3)
    expect(stringOffsetOfByte('äb', 2)).toBe(1)
  })

  it('renders the provisional tabs extension', () => {
    const source = ':::: tabs\n::: tab "Install"\nRun.\n:::\n::::\n'
    const html = render(source, { extensions: tabsExtensions, renderers: { 'carve.tabs': tabsRenderer } })
    expect(html).toContain('Install')
    optionError(() => render('a', { renderers: { x: { render: () => '' } } } as never), 'renderers')
  })
})

describe('writers', () => {
  it('writes with the built-in targets', () => {
    expect(writeDocument('html', parse('a'))).toEqual({ output: '<p>a</p>', diagnostics: [] })
    expect(writeDocument('carve', parse('a')).output).toBe('a\n')
    expect(writeDocument('html', parse('`x`{=latex}')).diagnostics.map((entry) => entry.code)).toEqual(['raw-format-dropped'])
    expect(refusal(() => writeDocument('html', parse('`x`{=latex}'), { strictLosses: true }))).toBeInstanceOf(CarveRenderError)
    optionError(() => writeDocument('markdown', parse('a')), 'target')
    optionError(() => writeDocument('html', parse('a'), { alignTables: true }), 'alignTables')
    optionError(() => writeDocument('carve', parse('a'), { headingIds: 'lower' }), 'headingIds')
    optionError(() => writeDocument('carve', parse('a'), { strictLosses: 1 } as never), 'strictLosses')
  })

  it('takes a stub writer beside the built-in ones', () => {
    const calls: unknown[] = []
    const stub: Writer = {
      target: 'stub',
      write(document, options) {
        calls.push(options)
        return { output: document.children.map((node) => node.type).join(','), diagnostics: [] }
      },
    }
    const writers = createWriterRegistry()
    writers.register(stub)
    expect(writers.targets()).toEqual(['html', 'carve', 'stub'])
    expect(writers.has('stub')).toBe(true)
    expect(writers.write('stub', parse('= a\n\nb'), { strictLosses: true }).output).toBe('heading,paragraph')
    expect(calls).toEqual([{ strictLosses: true }])
    expect(createWriterRegistry().has('stub')).toBe(false)
    expect(refusal(() => writeDocument('stub', parse('a')))).toBeInstanceOf(CarveOptionError)
  })

  it('refuses taken, reserved and malformed targets', () => {
    const writers = createWriterRegistry()
    const make = (target: unknown): Writer => ({ target, write: () => ({ output: '', diagnostics: [] }) }) as Writer
    expect(RESERVED_WRITER_TARGETS).toEqual(['markdown', 'plain-text', 'ansi'])
    for (const target of [...RESERVED_WRITER_TARGETS, 'html', 'carve', 'Upper', '', 1]) {
      optionError(() => writers.register(make(target)), 'writer')
    }
    optionError(() => writers.register({ target: 'x' } as never), 'writer')
  })
})

describe('the 0.2 API guide', () => {
  const guide = readFileSync(join(root, 'docs/api.md'), 'utf8')

  it('runs every example', async () => {
    const entry = pathToFileURL(join(root, 'public/index.ts')).href
    const dir = mkdtempSync(join(tmpdir(), 'carve-guide-'))
    const examples = [...guide.matchAll(/^```ts\n([\s\S]*?)^```$/gmu)].map((match) => match[1]!)
    expect(examples.length).toBeGreaterThanOrEqual(5)
    for (const [index, example] of examples.entries()) {
      const file = join(dir, `example-${index}.ts`)
      writeFileSync(file, example.replaceAll("'@markup-carve/carve'", JSON.stringify(entry)))
      await import(pathToFileURL(file).href)
    }
  })

  it('maps every value of the 0.1 package root', { timeout: 120_000 }, async () => {
    // A file URL keeps the 0.1 sources out of the 0.2 type check.
    const legacy = Object.keys(await import(pathToFileURL(join(root, 'upgrade/engine-0.1/index.ts')).href) as object)
    const section = guide.slice(guide.indexOf('## Migrating from 0.1'))
    const mapped = new Set<string>()
    for (const line of section.split('\n')) {
      if (!line.startsWith('| `')) continue
      const first = line.split('|')[1]!
      for (const match of first.matchAll(/`([^`]+)`/gu)) mapped.add(match[1]!)
    }
    expect(legacy.filter((name) => !mapped.has(name))).toEqual([])
    const named = [...section.matchAll(/^\| [^|]+ \| `(\w+)`(?! \(`)/gmu)].map((match) => match[1]!)
    expect(named.filter((name) => !(name in api))).toEqual([])
  })
})
