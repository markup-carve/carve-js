import { describe, expect, it } from 'vitest'
import { expandIncludes, parse, resolve, toAstJson } from '../src/index.js'
import { mergeRun } from '../src/coalesce-text-runs.js'

// A merged include run keeps the span the host text had before expansion (carve-js#1735).

type Files = Record<string, string>

function expanded(entry: string, files: Files) {
  const doc = parse(entry, { positions: true })
  return expandIncludes(doc, entry, {
    resolve: (path) => (files[path] === undefined ? null : { source: files[path]!, id: path }),
  }).doc
}

function blockText(doc: ReturnType<typeof expanded>, index: number): Record<string, unknown> {
  const block = toAstJson(doc).children[index] as unknown as { children: Array<Record<string, unknown>> }
  expect(block.children).toHaveLength(1)
  return block.children[0]!
}

const HOST_SPAN = { startLine: 1, endLine: 1, startColumn: 1, endColumn: 31, startOffset: 0, endOffset: 30 }

describe('a merged include run', () => {
  it('carries the span of the host text it was spliced into', () => {
    const doc = expanded('Root {{ sub/child.crv }} tail.\n', { 'sub/child.crv': 'inlined text\n' })

    expect(blockText(doc, 0)).toEqual({ type: 'text', value: 'Root inlined text tail.', pos: HOST_SPAN })
  })

  it('keeps that span through resolve()', () => {
    const doc = resolve(expanded('Root {{ sub/child.crv }} tail.\n', { 'sub/child.crv': 'inlined text\n' }))

    expect(blockText(doc, 0)['pos']).toEqual(HOST_SPAN)
  })

  it('runs from the first host piece to the last when they came from two nodes', () => {
    // `@shift` parses as a mention, so the host halves are two text nodes.
    const doc = expanded('Root {{ c.crv @shift:1 }} tail.\n', { 'c.crv': 'inlined\n' })

    expect(blockText(doc, 0)).toEqual({
      type: 'text',
      value: 'Root inlined tail.',
      pos: { startLine: 1, endLine: 1, startColumn: 1, endColumn: 32, startOffset: 0, endOffset: 31 },
    })
  })

  it('carries the host span when the include leads the run', () => {
    const doc = expanded('{{ c.crv }} tail.\n', { 'c.crv': 'lead\n' })

    expect(blockText(doc, 0)['pos']).toEqual({
      startLine: 1,
      endLine: 1,
      startColumn: 1,
      endColumn: 18,
      startOffset: 0,
      endOffset: 17,
    })
  })

  it('names the child file when the run sits in a child', () => {
    const doc = expanded('Root\n\n{{ a.crv }}\n', { 'a.crv': 'x\n\nMid {{ b.crv }} end\n', 'b.crv': 'deep\n' })

    expect(blockText(doc, 2)).toEqual({
      type: 'text',
      value: 'Mid deep end',
      pos: { startLine: 3, endLine: 3, startColumn: 1, endColumn: 20, startOffset: 3, endOffset: 22, file: 'a.crv' },
    })
  })
})

describe('a host half that merges with nothing', () => {
  // PART 12 §4: a slice carries the part of the host span it covers (carve-js#1764).
  const spans = (entry: string, files: Files) =>
    (toAstJson(expanded(entry, files)).children[0] as unknown as { children: Array<Record<string, any>> }).children.map(
      (node) => [node['value'] ?? node['type'], node['pos']?.startOffset, node['pos']?.endOffset],
    )

  it('narrows both halves around the include', () => {
    expect(spans('Root {{ c.crv }} tail.\n', { 'c.crv': '*b*\n' })).toEqual([
      ['Root ', 0, 5],
      ['strong', 0, 3],
      [' tail.', 16, 22],
    ])
  })

  it('narrows a trailing half when the include leads the line', () => {
    expect(spans('{{ c.crv }} tail.\n', { 'c.crv': '*b*\n' })).toEqual([
      ['strong', 0, 3],
      [' tail.', 11, 17],
    ])
  })

  it('narrows a half cut from a later node of the run', () => {
    // `@shift` parses as a mention, so ` }} tail.` is its own text node.
    expect(spans('Root {{ c.crv @shift:1 }} tail.\n', { 'c.crv': '*b*\n' })).toEqual([
      ['Root ', 0, 5],
      ['strong', 0, 3],
      [' tail.', 25, 31],
    ])
  })

  it('counts the offsets and columns in codepoints', () => {
    const tail = (toAstJson(expanded('😀 {{ c.crv }} ü😀.\n', { 'c.crv': '*b*\n' })).children[0] as unknown as {
      children: Array<Record<string, unknown>>
    }).children[2]!

    expect(tail).toEqual({
      type: 'text',
      value: ' ü😀.',
      pos: { startLine: 1, endLine: 1, startColumn: 14, endColumn: 18, startOffset: 13, endOffset: 17 },
    })
  })

  it('publishes no span for a half of a node that crosses a line', () => {
    const source = 'Root {{ c.crv }} tail.\n'
    const doc = parse(source, { positions: true })
    const text = (doc.children[0] as unknown as { children: Array<{ pos: Record<string, number> }> }).children[0]!
    text.pos.endLine = 2
    const out = expandIncludes(doc, source, { resolve: () => ({ source: '*b*\n', id: 'c.crv' }) }).doc
    const halves = (toAstJson(out).children[0] as unknown as { children: Array<Record<string, unknown>> }).children

    expect(halves[0]).toEqual({ type: 'text', value: 'Root ' })
    expect(halves[2]).toEqual({ type: 'text', value: ' tail.' })
  })
})

describe('a merged run beside a half that merges with nothing', () => {
  it('keeps the extent of the whole run it was cut from', () => {
    const doc = expanded('a {{ c.crv }} b {{ d.crv }} e\n', { 'c.crv': 'x\n', 'd.crv': '*y*\n' })
    const children = (toAstJson(doc).children[0] as unknown as { children: Array<Record<string, any>> }).children

    expect([children[0]!['value'], children[0]!['pos'].startOffset, children[0]!['pos'].endOffset]).toEqual(['a x b ', 0, 29])
    expect([children[2]!['value'], children[2]!['pos'].startOffset, children[2]!['pos'].endOffset]).toEqual([' e', 27, 29])
  })
})

describe('a merged run from one file', () => {
  it('still publishes no span where its pieces are not contiguous', () => {
    const at = (startOffset: number, endOffset: number) => ({
      startLine: 1,
      endLine: 1,
      startColumn: startOffset + 1,
      endColumn: endOffset + 1,
      startOffset,
      endOffset,
    })
    const merged = mergeRun(
      [
        { type: 'text', value: 'a', pos: at(0, 1) },
        { type: 'text', value: 'b', pos: at(2, 3) },
      ],
      { file: undefined },
    )

    expect(merged).toEqual([{ type: 'text', value: 'ab', pos: undefined }])
  })
})
