import { expect, it } from 'vitest'
import { decisionTrace } from '../src/index.js'

// carve-js#4915: the block a note's first-block `+` attaches is traced inside the note (CARVE-P9-067).
it('records a quote a note-line plus attaches in that note', () => {
  expect(decisionTrace('[^a]: +\n> q\n\nsee[^a]\n')).toEqual([
    { line: 1, step: 'S5', owner: 'doc/footnote:1', rule: 'CARVE-P0-024', form: 'footnote', cell: 'B-footnote-start' },
    { line: 2, step: 'S5', owner: 'doc/footnote:1/quote:2', rule: 'CARVE-P0-024', form: 'quote', cell: 'B-quote-start', plus: 1 },
    { line: 3, step: 'S5', owner: 'doc/footnote:1', rule: 'CARVE-P0-003', form: 'blank' },
    { line: 4, step: 'S5', owner: 'doc', rule: 'CARVE-P0-024', form: 'text', closed: 1, reached: 'doc' },
  ])
})

it('records a fence a note-line plus attaches in that note, in a list item too', () => {
  for (const [source, owner] of [
    ['[^a]: +\n```\nx\n```\n', 'doc/footnote:1/code:2'],
    ['- [^a]: +\n  ```\n  x\n  ```\n', 'doc/item:1/footnote:1/code:2'],
  ] as const) {
    expect(decisionTrace(source).filter(record => record.line > 1).map(record => record.owner)).toEqual([owner, owner, owner])
  }
})
