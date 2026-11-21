// The reader checks freeze candidate 4 adds (C2-A-188): one encoding for each default, the shapes of keys,
// glyphs, groups and cells, and the fields of extension nodes. Each test names its clause.
import { describe, expect, it } from 'vitest'
import { CarveTreeError, parse, validateTree } from '../src/index.ts'

function refusal(value: unknown): string | null {
  try {
    validateTree(value)
    return null
  } catch (error) {
    if (error instanceof CarveTreeError) return error.path
    throw error
  }
}

function inParagraph(...children: unknown[]): unknown {
  return { type: 'document', astVersion: '2.0', children: [{ type: 'paragraph', children }] }
}

function withAttrs(attrs: unknown): unknown {
  return { type: 'document', astVersion: '2.0', children: [{ type: 'paragraph', attrs, children: [{ type: 'text', value: 'a' }] }] }
}

const cell = (children: unknown[], fields: Record<string, unknown> = {}): unknown => ({ type: 'table_cell', header: false, children, ...fields })
const text = (value: string): unknown => ({ type: 'cell_paragraph', children: [{ type: 'text', value }] })
const table = (groups: unknown[]): unknown => ({ type: 'document', astVersion: '2.0', children: [{ type: 'table', columns: [{ type: 'table_column' }], children: groups }] })
const group = (type: string, cells: unknown[] = [cell([text('a')])]): unknown => ({ type, children: [{ type: 'table_row', children: cells }] })

describe('one encoding of each default', () => {
  it('C2-A-058: an empty attrs, classes or keyValues is refused', () => {
    expect(refusal(withAttrs({}))).toBe('/children/0/attrs')
    expect(refusal(withAttrs({ classes: [] }))).toBe('/children/0/attrs/classes')
    expect(refusal(withAttrs({ keyValues: [] }))).toBe('/children/0/attrs/keyValues')
    expect(refusal(withAttrs({ classes: ['c'], keyValues: [['k', 'v']] }))).toBeNull()
  })

  it('C2-A-058, C2-X-037: an empty props, slots or payload of an extension node is refused', () => {
    const declared = (fields: Record<string, unknown>): unknown => ({
      type: 'document', astVersion: '2.0', extensions: [{ name: 'org.example.n', version: '1', required: false, slots: ['s'] }],
      children: [{ type: 'block_extension', name: 'org.example.n', version: '1', children: [],
        fallback: [{ type: 'paragraph', children: [{ type: 'text', value: 'a' }] }], ...fields }],
    })
    expect(refusal(declared({ props: {} }))).toBe('/children/0/props')
    expect(refusal(declared({ slots: {} }))).toBe('/children/0/slots')
    expect(refusal(declared({ payload: [] }))).toBe('/children/0/payload')
    expect(refusal(declared({ props: { a: 1 }, slots: { s: [] }, payload: [{ format: 'text/plain', value: 'x' }] }))).toBeNull()
  })

  it('C2-A-058, C2-A-216: an autolink text equal to its href is refused, the email form keeps its text', () => {
    expect(refusal(inParagraph({ type: 'autolink', href: 'https://x.org', text: 'https://x.org' }))).toBe('/children/0/children/0/text')
    expect(refusal(inParagraph({ type: 'autolink', href: 'mailto:a@b.org', text: 'a@b.org' }))).toBeNull()
  })

  it('C2-A-056, C2-A-058: an ordered marker carries its style and delimiter, and a start of 0 to 999999999', () => {
    const list = (marker: unknown): unknown => ({ type: 'document', astVersion: '2.0', children: [{ type: 'list', marker, spacing: 'tight',
      children: [{ type: 'list_item', children: [{ type: 'paragraph', children: [{ type: 'text', value: 'a' }] }] }] }] })
    expect(refusal(list({ kind: 'ordered', style: '1' }))).toBe('/children/0/marker/delimiter')
    expect(refusal(list({ kind: 'ordered', style: '1', delimiter: '.', start: -1 }))).toBe('/children/0/marker/start')
    expect(refusal(list({ kind: 'ordered', style: '1', delimiter: '.', start: 0 }))).toBeNull()
    expect(refusal(list({ kind: 'ordered', style: '1', delimiter: '.', start: 999_999_999 }))).toBeNull()
  })
})

describe('the shapes a reader checks', () => {
  it('C2-A-035, C2-I-030: a key that is no key is refused, whatever it would inject', () => {
    for (const key of ['x onclick', '', '1a', 'a=b', '-a']) expect(refusal(withAttrs({ keyValues: [[key, 'v']] })), key).toBe('/children/0/attrs/keyValues/0/0')
    expect(refusal(withAttrs({ keyValues: [['_a-1', 'v']] }))).toBeNull()
  })

  it('C2-A-098: the glyph and the source are those of the kind', () => {
    const smart = (fields: Record<string, unknown>): unknown => inParagraph({ type: 'smart_punctuation', kind: 'en_dash', ...fields })
    expect(refusal(smart({ source: '--', glyph: '–' }))).toBeNull()
    expect(refusal(smart({ source: '--' }))).toBe('/children/0/children/0/glyph')
    expect(refusal(smart({ source: '---', glyph: '–' }))).toBe('/children/0/children/0/source')
  })

  it('C2-A-102: numberPrefix alone stands on a display equation, number only with it, neither on inline math', () => {
    const math = (fields: Record<string, unknown>): unknown => inParagraph({ type: 'math', value: 'x', ...fields })
    expect(refusal(math({ display: true, numberPrefix: 'Eq.' }))).toBeNull()
    expect(refusal(math({ display: true, number: 2 }))).toBe('/children/0/children/0/number')
    expect(refusal(math({ display: false, numberPrefix: 'Eq.' }))).toBe('/children/0/children/0/numberPrefix')
  })

  it('C2-A-086: at most one head, then the bodies, then at most one foot', () => {
    expect(refusal(table([group('table_head'), group('table_body'), group('table_body'), group('table_foot')]))).toBeNull()
    expect(refusal(table([group('table_head'), group('table_head')]))).toBe('/children/0/children/1')
    expect(refusal(table([group('table_foot'), group('table_foot')]))).toBe('/children/0/children/1')
    expect(refusal(table([group('table_body'), group('table_head')]))).toBe('/children/0/children/1')
  })

  it('C2-A-091, C2-A-092: an ordinary cell holds at least one block and a cell_paragraph only alone; a mark cell stays empty', () => {
    expect(refusal(table([group('table_body', [cell([])])]))).toBe('/children/0/children/0/children/0/children/0/children')
    expect(refusal(table([group('table_body', [cell([text('a'), text('b')])])]))).toBe('/children/0/children/0/children/0/children/0/children/0')
    expect(refusal(table([group('table_body', [cell([text('a')], { colspan: 2 }), cell([], { span: 'colspan' })])]))).toBeNull()
    expect(() => validateTree(parse('| a | < |\n| b | c |'))).not.toThrow()
  })

  it('C2-A-181, C2-N-073: a caption stands only on a code include', () => {
    const include = (options?: unknown): unknown => ({ type: 'document', astVersion: '2.0', children: [{ type: 'include', path: 'a.txt',
      ...(options === undefined ? {} : { options }), caption: { type: 'caption', children: [{ type: 'paragraph', children: [{ type: 'text', value: 'c' }] }] } }] })
    expect(refusal(include())).toBe('/children/0/caption')
    expect(refusal(include({ lines: '1-2' }))).toBe('/children/0/caption')
    expect(refusal(include({ code: true }))).toBeNull()
  })
})

describe('extension nodes', () => {
  const sourced = (source: Record<string, string>, type = 'block_extension'): unknown => {
    const node = { type, name: 'org.example.n', version: '1', children: [], source,
      fallback: type === 'block_extension' ? [{ type: 'paragraph', children: [{ type: 'text', value: 'a' }] }] : [{ type: 'text', value: 'a' }] }
    return { type: 'document', astVersion: '2.0', extensions: [{ name: 'org.example.n', version: '1', required: false, slots: [] }],
      children: [type === 'block_extension' ? node : { type: 'paragraph', children: [node] }] }
  }

  it('C2-X-025: a source name that no matcher of its form can claim is refused', () => {
    expect(refusal(sourced({ form: 'fence', name: '=html', body: 'x\n' }))).toBe('/children/0/source/name')
    expect(refusal(sourced({ form: 'div', name: 'note', body: 'x\n' }))).toBe('/children/0/source/name')
    expect(refusal(sourced({ form: 'div', name: 'figure', body: 'x\n' }))).toBe('/children/0/source/name')
    expect(refusal(sourced({ form: 'div', name: 'a b', body: 'x\n' }))).toBe('/children/0/source/name')
    expect(refusal(sourced({ form: 'fence', name: 'mermaid', body: 'x\n' }))).toBeNull()
    expect(refusal(sourced({ form: 'div', name: 'tabs', body: 'x\n' }))).toBeNull()
    expect(refusal(sourced({ form: 'div', name: 'figure', title: 'T', body: 'x\n' }))).toBeNull()
    expect(refusal(sourced({ form: 'inline', name: '1x', body: 'x' }, 'inline_extension'))).toBe('/children/0/children/0/source/name')
    expect(refusal(sourced({ form: 'inline', name: 'kbd', body: 'x' }, 'inline_extension'))).toBeNull()
  })

  it('C2-A-124: an unqualified inline extension carries its name, its children and the common fields only', () => {
    const node = (fields: Record<string, unknown>): unknown => inParagraph({ type: 'inline_extension', name: 'kbd', children: [], ...fields })
    expect(refusal(node({ attrs: { classes: ['c'] } }))).toBeNull()
    for (const name of ['fallback', 'props', 'payload', 'resourceIds']) {
      const value = name === 'props' ? { a: 1 } : name === 'fallback' ? [{ type: 'text', value: 'f' }] : name === 'payload' ? [{ format: 'a', value: 'b' }] : ['r']
      expect(refusal(node({ [name]: value })), name).toBe(`/children/0/children/0/${name}`)
    }
  })
})
