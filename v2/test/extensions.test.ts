import { readFileSync } from 'node:fs'
import { Ajv2020 } from 'ajv/dist/2020.js'
import { describe, expect, it } from 'vitest'
import {
  CarveOptionError, CarveTreeError, decodeTree, format, parse, parseTree, parseWithLayout, render,
  renderWithDiagnostics, tabsExtensions, tabsRenderer, treesEqual, validateLayout, validateTree,
  writeWithDiagnostics, type BlockExtensionNode, type DocumentNode, type ExtensionDefinition,
} from '../src/index.ts'
import { calloutExtension, calloutRenderer, diagramExtension, diagramRenderer } from './support/extensions.ts'

const source = ':::: tabs\n::: tab "Install"\nRun setup.\n:::\n\n::: tab "Use"\nOpen the app.\n:::\n::::\n'
const html = '<div class="tabs" role="group" aria-label="Tabs"><input type="radio" name="tabs-1" id="tabs-1-0" checked>'
  + '<label for="tabs-1-0">Install</label><input type="radio" name="tabs-1" id="tabs-1-1"><label for="tabs-1-1">Use</label>'
  + '<div class="tab-panel" role="group" aria-label="Install"><p>Run setup.</p></div>'
  + '<div class="tab-panel" role="group" aria-label="Use"><p>Open the app.</p></div></div>'
const fallbackHtml = '<p><strong>Install</strong></p><p>Run setup.</p><p><strong>Use</strong></p><p>Open the app.</p>'

function paragraph(value: string) {
  return { type: 'paragraph' as const, children: [{ type: 'text' as const, value }] }
}

function expectedTab(title: string, body: string): BlockExtensionNode {
  return { type: 'block_extension', name: 'carve.tab', version: '1', children: [],
    slots: { title: [{ type: 'text', value: title }], body: [paragraph(body)] },
    fallback: [{ type: 'paragraph', children: [{ type: 'strong', children: [{ type: 'text', value: title }] }] }, paragraph(body)],
    source: { form: 'div', name: 'tab', title, body: `${body}\n` } }
}

function tabsTree(): DocumentNode {
  return parseTree(source, { extensions: tabsExtensions, positions: false }).document
}

function outer(document: DocumentNode): BlockExtensionNode {
  const node = document.children[0]
  if (node?.type !== 'block_extension') throw new Error('the first block is not an extension')
  return node
}

describe('the extension interface', () => {
  it('C2-X-001, C2-X-002, C2-X-018: a claim declares its qualified name and exact version on the root', () => {
    expect(tabsTree().extensions).toEqual([
      { name: 'carve.tab', version: '1', required: false }, { name: 'carve.tabs', version: '1', required: false },
    ])
    expect(outer(tabsTree())).toMatchObject({ name: 'carve.tabs', version: '1' })
  })

  it('C2-X-003, C2-X-004, C2-X-012: required unknown names fail and optional unknown names use a fallback', () => {
    const unknown: DocumentNode = { type: 'document', astVersion: '2.0',
      extensions: [{ name: 'test.missing', version: '1', required: false }],
      children: [{ type: 'block_extension', name: 'test.missing', version: '1', children: [], fallback: [paragraph('safe')] }] }
    expect(renderWithDiagnostics(unknown)).toMatchObject({ html: '<p>safe</p>',
      diagnostics: [{ code: 'extension-fallback-rendered', path: '/children/0' }] })
    unknown.extensions = [{ name: 'test.missing', version: '1', required: true }]
    expect(() => render(unknown)).toThrow(CarveTreeError)
    expect(parse('::: tab "Orphan"\nBody\n:::\n', { extensions: tabsExtensions }).children[0]?.type).toBe('div')
  })

  it('C2-X-005, C2-X-008, C2-X-009, C2-X-013, C2-X-016: matching follows the parsed div opener', () => {
    const one = '::: tabs\n::: tab "One"\nBody\n:::\n:::\n'
    expect(outer(parse(one, { extensions: tabsExtensions })).name).toBe('carve.tabs')
    expect(parse('{.tabs}\n::: \n::: tab "One"\nBody\n:::\n:::\n', { extensions: tabsExtensions }).children[0]?.type)
      .toBe('div')
    expect(parse('::: tabs\nOther\n:::\n', { extensions: tabsExtensions }).children[0]?.type).toBe('div')
    expect(parse('Text\n', { extensions: tabsExtensions, positions: false }).children[0]).toEqual(paragraph('Text'))
  })

  it('C2-X-006, C2-X-007, C2-X-010, C2-X-011, C2-X-015: inline and fence matchers use the same interface', () => {
    const extensions = [calloutExtension, diagramExtension]
    const inline = parse(':callout[Hi]{.mark}\n', { extensions, positions: false })
    expect(inline.children[0]).toMatchObject({ type: 'paragraph', children: [{ type: 'inline_extension',
      name: 'test.callout', version: '1', props: { tone: 'note' }, slots: { label: [{ type: 'text', value: 'Hi' }] },
      source: { form: 'inline', name: 'callout', body: 'Hi' }, attrs: { classes: ['mark'] } }] })
    const fence = parse('```diagram "Flow" [G]\na -> b\n```\n', { extensions, positions: false })
    expect(fence.children[0]).toMatchObject({ type: 'block_extension', name: 'test.diagram', version: '1',
      payload: [{ format: 'text/plain', value: 'a -> b\n' }],
      source: { form: 'fence', name: 'diagram', title: 'Flow', groupLabel: 'G', body: 'a -> b\n' } })
  })

  it('C2-X-014, C2-X-029: duplicate claims fail before parsing and repeated transforms agree', () => {
    const duplicate: ExtensionDefinition = { ...calloutExtension, name: 'test.other' }
    expect(() => parse('', { extensions: [calloutExtension, duplicate] })).toThrow(CarveOptionError)
    expect(parse(':callout[Hi]\n', { extensions: [calloutExtension], positions: false }))
      .toEqual(parse(':callout[Hi]\n', { extensions: [calloutExtension], positions: false }))
  })

  it('C2-X-019, C2-X-020, C2-X-021, C2-X-022: props, ordered slots, payload and fallback validate', () => {
    const tree = parseTree('```diagram\na -> b\n```\n', { extensions: [diagramExtension], positions: false }).document
    expect(() => validateTree(tree, undefined, undefined, [diagramExtension])).not.toThrow()
    const node = outer(tree)
    node.payload = [{ format: 'text/plain', value: null }]
    expect(() => validateTree(tree, undefined, undefined, [diagramExtension])).toThrow('/children/0/payload/0/value')
  })

  it('C2-X-023, C2-X-032, C2-X-035, C2-X-036: no renderer resolves and renders the fallback', () => {
    expect(renderWithDiagnostics(source, { extensions: tabsExtensions })).toMatchObject({ html: fallbackHtml,
      diagnostics: [{ code: 'extension-fallback-rendered', path: '/children/0' }] })
    const blocked = ':::: tabs\n::: tab "One"\n[x](javascript:alert)\n:::\n::::\n'
    expect(render(blocked, { extensions: tabsExtensions })).toContain('href=""')
    expect(render(blocked, { extensions: tabsExtensions, renderers: { 'carve.tabs': tabsRenderer } })).toContain('href=""')
  })

  it('C2-X-024, C2-X-025, C2-X-026, C2-X-027: source records and the writer carry the nested canonical divs', () => {
    const document = tabsTree()
    expect(outer(document).source).toEqual({ form: 'div', name: 'tabs',
      body: '::: tab "Install"\nRun setup.\n:::\n\n::: tab "Use"\nOpen the app.\n:::\n' })
    expect(writeWithDiagnostics(document, { extensions: tabsExtensions })).toEqual({ source, diagnostics: [] })
  })

  it('C2-X-028, C2-X-049: absent or inconsistent source writes fallback with a reported loss', () => {
    const document = tabsTree()
    delete outer(document).source
    const absent = writeWithDiagnostics(document, { extensions: tabsExtensions })
    expect(absent.diagnostics.map((entry) => entry.code)).toContain('structure-unspellable')
    expect(absent.source).toContain('*Install*')
    const inconsistent = tabsTree()
    const node = outer(inconsistent)
    if (node.source !== undefined) node.source.body = 'not the tabs\n'
    expect(writeWithDiagnostics(inconsistent, { extensions: tabsExtensions }).diagnostics.map((entry) => entry.code))
      .toContain('structure-unspellable')
  })

  it('C2-X-030, C2-X-031: extension nesting and decoded payload and source body are bounded', () => {
    const document = tabsTree()
    const node = outer(document)
    node.source = { form: 'div', name: 'tabs', body: 'x'.repeat(8 * 1024 * 1024 + 1) }
    expect(() => validateTree(document, undefined, undefined, tabsExtensions)).toThrow('source body above 8 MiB')
    delete node.source
    node.payload = [{ format: 'text/plain', value: 'x'.repeat(8 * 1024 * 1024 + 1) }]
    expect(() => validateTree(document, undefined, undefined, tabsExtensions)).toThrow('payload above 8 MiB')
  })

  it('C2-X-033, C2-X-034, C2-X-043, C2-X-044, C2-X-047, C2-X-048: tabs HTML is byte for byte', () => {
    expect(render(source, { extensions: tabsExtensions, renderers: { 'carve.tabs': tabsRenderer } })).toBe(html)
    const two = render(`${source}\n${source}`, { extensions: tabsExtensions, renderers: { 'carve.tabs': tabsRenderer } })
    expect(two).toContain('name="tabs-2" id="tabs-2-0"')
    expect(two.match(/id="tabs-1-0"/g)).toHaveLength(1)
  })

  it('C2-X-037: equality compares source, props, slots, payload and fallback', () => {
    const a = tabsTree()
    const b = tabsTree()
    expect(treesEqual(a, b)).toBe(true)
    outer(b).props = { changed: true }
    expect(treesEqual(a, b)).toBe(false)
  })

  it('C2-X-038, C2-X-046: known slots, prop types and tab placement are checked', () => {
    const document = tabsTree()
    outer(document).slots = { tabs: [paragraph('wrong')] }
    expect(() => validateTree(document, undefined, undefined, tabsExtensions)).toThrow('does not stand here')
    const orphan = tabsTree()
    const tab = outer(orphan).slots?.['tabs']?.[0]
    if (tab?.type !== 'block_extension') throw new Error('no tab')
    orphan.children = [tab]
    expect(() => validateTree(orphan, undefined, undefined, tabsExtensions)).toThrow('outside its parent slot')
  })

  it('C2-X-039, C2-X-040, C2-X-041, C2-X-042, C2-X-045: the worked tree is byte for byte', () => {
    const install = expectedTab('Install', 'Run setup.')
    const use = expectedTab('Use', 'Open the app.')
    expect(tabsTree()).toEqual({ type: 'document', astVersion: '2.0',
      extensions: [{ name: 'carve.tab', version: '1', required: false }, { name: 'carve.tabs', version: '1', required: false }],
      children: [{ type: 'block_extension', name: 'carve.tabs', version: '1', children: [], slots: { tabs: [install, use] },
        fallback: [...install.fallback, ...use.fallback], source: { form: 'div', name: 'tabs',
          body: '::: tab "Install"\nRun setup.\n:::\n\n::: tab "Use"\nOpen the app.\n:::\n' } }] })
  })

  it('C2-X-040: a missing or empty title and extra body blocks leave a core div', () => {
    for (const body of ['::: tab\nBody\n:::', '::: tab ""\nBody\n:::', '::: tab "One"\nBody\n:::\n\nOutside']) {
      expect(parse(`:::: tabs\n${body}\n::::\n`, { extensions: tabsExtensions }).children[0]?.type).toBe('div')
    }
  })

  it('C2-X-047: an absent title on a supplied tab uses a numbered label', () => {
    const document = tabsTree()
    const tab = outer(document).slots?.['tabs']?.[0]
    if (tab?.type !== 'block_extension') throw new Error('no tab')
    delete tab.slots?.['title']
    expect(render(document, { extensions: tabsExtensions, renderers: { 'carve.tabs': tabsRenderer } })).toContain('>Tab 1</label>')
  })

  it('C2-X-049: the two writer gates hold with and without extensions registered', () => {
    const once = format(source, { extensions: tabsExtensions })
    expect(once).toBe(source)
    expect(format(once, { extensions: tabsExtensions })).toBe(once)
    expect(treesEqual(parse(once, { extensions: tabsExtensions }), parse(source, { extensions: tabsExtensions }))).toBe(true)
    const core = format(source)
    expect(format(core)).toBe(core)
    expect(treesEqual(parse(core), parse(source))).toBe(true)
  })

  it('C2-X-031, C2-X-045: claimed nodes retain positions and a valid layout record', () => {
    const result = parseWithLayout(source, { extensions: tabsExtensions })
    expect(outer(result.document).pos).toMatchObject({ startOffset: 0, endOffset: source.length - 1 })
    expect(result.layout.nodes.some((entry) => entry.path === '/children/0')).toBe(true)
    expect(result.layout.nodes.some((entry) => entry.path === '/children/0/slots/tabs/0')).toBe(true)
    expect(() => validateLayout(result.layout)).not.toThrow()
  })

  it('C2-X-033, C2-X-034: the second extensions render through host escaping and write their claims', () => {
    const extensions = [calloutExtension, diagramExtension]
    const renderers = { 'test.callout': calloutRenderer, 'test.diagram': diagramRenderer }
    expect(render(':callout[<em>]\n', { extensions, renderers })).toBe('<p><span class="callout">&lt;em&gt;</span></p>')
    expect(render('```diagram\na < b\n```\n', { extensions, renderers })).toContain('a &lt; b')
    for (const text of [':callout[Hi]\n', '```diagram\na -> b\n```\n']) {
      const document = parse(text, { extensions, positions: false })
      const written = writeWithDiagnostics(document, { extensions })
      expect(written.diagnostics).toEqual([])
      expect(treesEqual(document, parse(written.source, { extensions, positions: false }))).toBe(true)
    }
  })

  it('C2-X-003: decoding checks a required name against the registered exact version', () => {
    const document = tabsTree()
    if (document.extensions === undefined) throw new Error('no declarations')
    document.extensions[1] = { name: 'carve.tabs', version: '2', required: true }
    expect(() => decodeTree(JSON.stringify(document), undefined, tabsExtensions)).toThrow('unknown required extension')
  })

  it('C2-X-019, C2-X-038: source produced extension trees agree with the specification schema', () => {
    const schema = JSON.parse(readFileSync(new URL('../data/ast-schema.json', import.meta.url), 'utf8')) as object
    const valid = new Ajv2020({ strict: true }).compile(schema)
    const inputs = [
      tabsTree(),
      parse(':callout[Hi]\n', { extensions: [calloutExtension], positions: false }),
      parse('```diagram\na -> b\n```\n', { extensions: [diagramExtension], positions: false }),
    ]
    for (const input of inputs) expect(valid(input), JSON.stringify(valid.errors?.[0])).toBe(true)
  })

  it('C2-A-190 to C2-A-209: declared standard data uses its value schema and placement', () => {
    const document: DocumentNode = { type: 'document', astVersion: '2.0', children: [paragraph('Draft')],
      extensions: ['carve.source', 'carve.style', 'carve.annotation']
        .map((name) => ({ name, version: '1', required: false })),
      data: { 'carve.style': { page: { widthPt: 595, heightPt: 842,
        marginsPt: { top: 72, right: 72, bottom: 72, left: 72 } } } } }
    const child = document.children[0]
    if (child === undefined) throw new Error('missing paragraph')
    child.data = { 'carve.source': { format: 'docx', locator: { part: 'word/document.xml' },
      importer: { name: 'tester', version: '1' } }, 'carve.annotation': { ids: ['comment-7'] } }
    expect(() => validateTree(document)).not.toThrow()
    document.data = { 'carve.style': { page: { widthPt: -1, heightPt: 842, marginsPt: {} } } }
    expect(() => validateTree(document)).toThrow('positive number')
    delete document.data
    child.data = { 'carve.style': { namedStyles: {} } }
    expect(() => validateTree(document)).toThrow('only on the root')
  })
})
