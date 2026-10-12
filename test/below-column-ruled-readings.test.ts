import { expect, it } from 'vitest'
import { parse, renderHtml } from '../src/index.js'

const normalized = (html: string) => html.replace(/>\s+</g, '><').trim()
const lines = (...source: string[]) => source.join('\n') + '\n'

// CARVE-P0-009: the deepest frame is the empty container in `c`, which holds
// no paragraph, so the unmarked line closes the list and no surviving frame
// adopts it. The spec checker folds it into item `b` instead.
const rootList =
  '<blockquote><ul><li>a</li></ul><ul><li>b\n      <ul><li>c\n          <div></div></li></ul></li></ul></blockquote>' +
  '<ol><li>lazy</li></ol>'

for (const indent of [6, 8]) {
  for (const blank of [false, true]) {
    it(`writes a root list after an empty container at ${indent} columns${blank ? ' below a quoted blank' : ''}`, () => {
      const source = lines(
        '>   - a',
        '> - b',
        '>     - c',
        ...(blank ? ['>'] : []),
        `>${' '.repeat(indent + 1)}:::`,
        '1. lazy',
      )
      expect(normalized(renderHtml(parse(source)))).toBe(rootList)
      expect(normalized(renderHtml(parse(source, { positions: true })))).toBe(rootList)
    })
  }
}

// A comment below the item's content column is not the line that reaches it,
// so the marker-line colon run gets no body and stays item text. The checker
// opens the container on the comment.
it('keeps a marker-line colon run as text across a below-column comment', () => {
  const document = parse(lines('- ::: inner', ' %% c', ' text'))
  const html = renderHtml(document)
  expect(html).not.toContain('<div')
  expect(html).toContain('<li>::: inner')
  expect(html.indexOf('text')).toBeLessThan(html.indexOf('</li>'))
  const list = document.children[0]
  expect(list?.type).toBe('list')
  expect(document.children).toHaveLength(1)
})
