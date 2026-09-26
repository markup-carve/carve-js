import { describe, expect, it } from 'vitest'
import { fromAstJson, renderAnsi, renderMarkdown, renderPlainText } from '../src/index.js'

// carve-js#2119. PART 12 §27 (CARVE-P12-049): Markdown, plain and ANSI each
// write a cell on ONE LINE, so `blocks` flattens under PART 11 §1b with the
// blocks separated by one space.
const table = (blocks: unknown[]) => fromAstJson({
  type: 'document',
  srcByteLength: 0,
  children: [{
    type: 'table',
    rows: [
      { type: 'table_row', cells: [{ type: 'table_cell', header: true, children: [{ type: 'text', value: 'H' }] }] },
      { type: 'table_row', cells: [{ type: 'table_cell', header: false, blocks }] },
    ],
  }],
} as never)

const paragraph = (value: string) => ({ type: 'paragraph', children: [{ type: 'text', value }] })

describe('a block-bearing table cell flattens to one line', () => {
  it.each([
    [
      'two paragraphs, separated by one space',
      [paragraph('one'), paragraph('two')],
      'one two',
    ],
    [
      "a list's items in order and no markers",
      [{
        type: 'list', ordered: false, tight: true, items: [
          { type: 'list_item', children: [paragraph('a')] },
          { type: 'list_item', children: [paragraph('b')] },
        ],
      }],
      'a b',
    ],
    [
      'a quotation beside a paragraph',
      [{ type: 'block_quote', children: [paragraph('quoted')] }, paragraph('after')],
      'quoted after',
    ],
  ])('writes %s', (_, blocks, flattened) => {
    expect(renderMarkdown(table(blocks))).toContain(`| ${flattened} |`)
  })

  // The clause also says a code block contributes its payload with each newline
  // becoming one space. carve-js#2125 took the fence out of the cell; this pins
  // the newline half of the same sentence.
  it("turns a code block's newlines into spaces", () => {
    const rendered = renderMarkdown(table([{ type: 'code_block', content: 'first\nsecond\n' }]))
    expect(rendered).toContain('first second')
    expect(rendered).not.toContain('<br>')
  })

  // The three line-oriented targets agree, which is what carve-js#2119 reported:
  // plain and ANSI already wrote one space where Markdown wrote `<br>`.
  it('agrees with the plain and ANSI targets', () => {
    const doc = table([paragraph('one'), paragraph('two')])
    expect(renderMarkdown(doc)).toContain('| one two |')
    expect(renderPlainText(doc)).toContain('one two')
    expect(renderAnsi(doc)).toContain('one two')
  })

  it('writes no <br> between the blocks', () => {
    expect(renderMarkdown(table([paragraph('one'), paragraph('two')]))).not.toContain('<br>')
  })

  // PART 11 §9a (markup-carve/carve#2363) is the separate case: a hard break
  // inside one of those blocks still writes `<br>`, because a newline would end
  // the GFM row. The one-space join must not swallow it.
  it('keeps a hard break inside a block as <br>', () => {
    const doc = table([{
      type: 'paragraph',
      children: [{ type: 'text', value: 'a' }, { type: 'hard_break' }, { type: 'text', value: 'b' }],
    }])
    expect(renderMarkdown(doc)).toContain('| a<br>b |')
  })
})
