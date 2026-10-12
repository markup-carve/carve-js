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

// The comment ends the empty marker-line container; text belongs to the document.
it('ends a marker-line colon container across a below-column comment', () => {
  const document = parse(lines('- ::: inner', ' %% c', ' text'))
  expect(normalized(renderHtml(document))).toBe('<ul><li><div class="inner"></div></li></ul><p>text</p>')
  expect(document.children.map(node => node.type)).toEqual(['list', 'comment', 'paragraph'])
})
