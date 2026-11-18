import { expect, it } from 'vitest'
import { parse, render } from '../src/index.ts'

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
