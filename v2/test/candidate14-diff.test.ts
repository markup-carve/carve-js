import { expect, it } from 'vitest'
import { parse, parseWithDiagnostics, render } from '../src/index.ts'

it('C2-H-006, C2-H-133: a quote with one unresolved include writes compactly', () => {
  expect(render('> {{ "a" }}')).toBe('<blockquote><p>{{ a }}</p></blockquote>')
})

it('C2-A-089: table alignment resolves inside an unused footnote', () => {
  const note = parse('[^n]: |={<} a |').children[0]
  expect(note?.type).toBe('footnote')
  if (note?.type !== 'footnote') return
  const table = note.children[0]
  expect(table?.type).toBe('table')
  if (table?.type === 'table') expect(table.columns[0]?.resolvedAlign).toBe('left')
})

it('C2-A-089, C2-H-057: a vertical placeholder consumes its covered row before the next cell', () => {
  const source = '|={>} A |= B |\n| a | b |\n|= H |\n|={.x} ^ |\n| a |'
  expect(render(source)).toContain('<tr><td style="text-align: right;">a</td></tr>')
})

it('C2-B-130: a lazy line of a line block keeps its one leading space', () => {
  expect(render(' - ::: |\n   a\n b')).toContain('a<br>\n&nbsp;b</p>')
})

it('C2-H-091: an empty inline note writes its backlink in a paragraph', () => {
  expect(render('x ^[]')).toContain('<p><a href="#fnref1" role="doc-backlink" aria-label="Back to reference">↩</a></p>')
})

it('C2-A-135: a cross-reference in an unused note resolves to the heading', () => {
  const note = parse('# h\n\n[^1]: ^[</#h>]').children[1]
  expect(note?.type).toBe('footnote')
  if (note?.type !== 'footnote') return
  const source = JSON.stringify(note)
  expect(source).toContain('"href":"#h"')
})

it('C2-N-074, C2-A-025: an unexpanded include visits its caption and resolves its inline note', () => {
  const source = '{{ a.txt @code }}\n^ Listing #: x^[note] [s]{#q}'
  const include = parse(source).children[0]
  expect(include?.type).toBe('include')
  if (include?.type === 'include') {
    expect(JSON.stringify(include.caption)).toContain('"number":1')
  }
  expect(render(source)).toContain('<section role="doc-endnotes"')
  expect(render(source)).toContain('<p>note<a href="#fnref1"')
})

it('C2-B-024, C2-A-140: a lazy comment extends the line that owns it', () => {
  const source = '- ::: |\n  a\n%% c\nb'
  const list = parse(source).children[0]
  expect(list?.type).toBe('list')
  if (list?.type !== 'list') return
  const block = list.children[0]?.children[0]
  expect(block?.type).toBe('line_block')
  if (block?.type === 'line_block') {
    expect(block.children[0]?.pos?.endOffset).toBe(Buffer.byteLength('- ::: |\n  a\n%% c'))
    expect(block.children[0]?.pos?.endLine).toBe(3)
  }
})

it('C2-B-085, C2-W-138: a duplicate footnote ranges only its marker', () => {
  for (const source of [
    '[^a]: +\n[^a]: +\n- b\n\n[^a]\n',
    '[^é]: first\n\n[^é]: second\n',
    '[^a\\]b]: first\n\n[^a\\]b]: second\n',
  ]) {
    const finding = parseWithDiagnostics(source).diagnostics.find((entry) => entry.code === 'duplicate-footnote-definition')
    const start = source.indexOf('[^', source.indexOf('[^') + 2)
    const startOffset = Buffer.byteLength(source.slice(0, start))
    const marker = source.slice(start).split(':', 1)[0] + ':'
    expect(finding?.range).toEqual({ startOffset, endOffset: startOffset + Buffer.byteLength(marker) })
  }
})

it('C2-W-138: a duplicate id points to its authored attribute behind marker-shaped content', () => {
  for (const source of ['{#a}\nx\n\n[#a]{#a}', '{#a}\nx\n\n[k]{k=" #a" #a}']) {
    const finding = parseWithDiagnostics(source).diagnostics.find((entry) => entry.code === 'duplicate-id')
    const startOffset = source.lastIndexOf('#a')
    expect(finding?.range).toEqual({ startOffset, endOffset: startOffset + 2 })
  }
  const source = '{#a}\nx\n\n{#a}\n# #a'
  const finding = parseWithDiagnostics(source).diagnostics.find((entry) => entry.code === 'duplicate-id')
  const startOffset = source.lastIndexOf('{#a}') + 1
  expect(finding?.range).toEqual({ startOffset, endOffset: startOffset + 2 })
})
