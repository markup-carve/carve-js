import { describe, expect, it } from 'vitest'
import { fromAstJson, renderAnsi, renderCarve, renderMarkdown, renderPlainText } from '../src/index.js'

// carve-js#2239. A cell flattens to one line, so the order the blocks
// contribute in is the only thing that says which text is the body and which is
// the caption. The Carve target read the caption first, so a quote attributed
// to someone came back as if the author had written the name into the quote.
const cellDoc = (target: unknown) => fromAstJson({
  type: 'document',
  srcByteLength: 0,
  children: [{
    type: 'table',
    rows: [{
      type: 'table_row',
      cells: [{
        type: 'table_cell',
        header: false,
        blocks: [{ type: 'figure', target, caption: [{ type: 'text', value: 'Steve Jobs' }] }],
      }],
    }],
  }],
} as never)

const quoteTarget = {
  type: 'block_quote',
  children: [{ type: 'paragraph', children: [{ type: 'text', value: 'Stay hungry, stay foolish.' }] }],
}

describe('a figure in a table cell writes its body before its caption', () => {
  it('orders the Carve target body first', () => {
    expect(renderCarve(cellDoc(quoteTarget))).toBe('| Stay hungry, stay foolish. Steve Jobs |\n')
  })

  it('agrees across every line-oriented target', () => {
    const doc = cellDoc(quoteTarget)
    expect(renderMarkdown(doc).split('\n')[2]).toBe('| Stay hungry, stay foolish. Steve Jobs |')
    expect(renderPlainText(doc)).toBe('Stay hungry, stay foolish. Steve Jobs\n')
    // eslint-disable-next-line no-control-regex
    expect(renderAnsi(doc).replace(/\u001b\[[0-9;]*m/g, '').split('\n')[1]).toBe(
      '│ Stay hungry, stay foolish. Steve Jobs │',
    )
  })

  it('keeps the order for an image target, whose body is one inline', () => {
    expect(renderCarve(cellDoc({ type: 'image', src: 'a.png', alt: 'a chart' })))
      .toBe('| ![a chart](a.png) Steve Jobs |\n')
  })
})
