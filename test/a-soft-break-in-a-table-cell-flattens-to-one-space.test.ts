import { describe, expect, it } from 'vitest'

import { fromAstJson, parse, renderMarkdown } from '../src/index.js'

/*
 * A SOFT BREAK IN A TABLE CELL FLATTENS TO ONE SPACE (markup-carve/carve#2421).
 *
 * The Markdown target wrote the raw newline, which ENDS the GFM row: the cell
 * after it started a new line and the table broke apart. A cell is a
 * single-line slot, so PART 11 §1b flattens the break, exactly as §9a already
 * makes the hard break `<br>` here.
 *
 * ONE SPACE, NOT `<br>`. A soft break is the break that does not render as a
 * break, so writing `<br>` would invent a visible line break the document never
 * had, which CARVE-P11-008 forbids.
 *
 * ANY CELL, not only a list-table's. PART 11 §10q L1 puts a single-paragraph
 * cell's inline content in the cell, and the plain pipe-table writer reaches the
 * same inline path, so both spellings carried the defect. A cell that holds
 * `blocks` already flattened, through the block-cell flattener.
 */

/** A one-row table whose first cell holds `children`, as `table_cell` does. */
const inlineCell = (children: unknown[]) => ({
  type: 'table_cell', header: false, sourceContent: 'inline',
  children: [{ type: 'cell_paragraph', children }],
})

const cellTable = (children: unknown[]): ReturnType<typeof fromAstJson> =>
  fromAstJson({
    type: 'document',
    astVersion: '2.0',
    stages: ['blockImagePromotion', 'referenceResolution', 'tableAlignment'],
    srcByteLength: 0,
    children: [
      {
        type: 'table',
        columns: [{ type: 'table_column' }, { type: 'table_column' }],
        children: [{ type: 'table_body', children: [
          {
            type: 'table_row',
            children: [
              inlineCell(children),
              inlineCell([{ type: 'text', value: 'x' }]),
            ],
          },
        ] }],
      },
    ],
  } as never)

const row = (markdown: string): string => markdown.trimEnd().split('\n').at(-1)!

describe('a soft break in a list-table cell', () => {
  // PART 11 §10q's own worked example spells this document and shows
  // `| one two | x |`, so the spec displayed the answer while the clause text
  // was missing.
  const source = '{header-rows=1}\n::: list-table\n- - A\n  - B\n- - one\n    two\n  - x\n:::'

  it('writes the cell on one line', () => {
    expect(renderMarkdown(parse(source))).toBe('| A | B |\n| --- | --- |\n| one two | x |\n')
  })

  it('leaves the row unsplit, so the table is still three lines', () => {
    expect(renderMarkdown(parse(source)).trimEnd().split('\n')).toHaveLength(3)
  })
})

describe('a soft break in a plain pipe-table cell', () => {
  const soft = cellTable([
    { type: 'text', value: 'one' },
    { type: 'soft_break' },
    { type: 'text', value: 'two' },
  ])

  it('writes the cell on one line', () => {
    expect(row(renderMarkdown(soft))).toBe('| one two | x |')
  })

  it('writes no newline inside the row', () => {
    expect(renderMarkdown(soft).trimEnd().split('\n')).toHaveLength(3)
  })

  it('writes no <br>, which would invent a visible break', () => {
    expect(renderMarkdown(soft)).not.toContain('<br>')
  })
})

describe('a soft break in a block cell', () => {
  const blocks = fromAstJson({
    type: 'document',
    astVersion: '2.0',
    stages: ['blockImagePromotion', 'referenceResolution', 'tableAlignment'],
    srcByteLength: 0,
    children: [
      {
        type: 'table',
        columns: [{ type: 'table_column' }, { type: 'table_column' }],
        children: [{ type: 'table_body', children: [
          {
            type: 'table_row',
            children: [
              {
                type: 'table_cell',
                header: false,
                sourceContent: 'blocks',
                children: [
                  {
                    type: 'paragraph',
                    children: [
                      { type: 'text', value: 'one' },
                      { type: 'soft_break' },
                      { type: 'text', value: 'two' },
                    ],
                  },
                ],
              },
              inlineCell([{ type: 'text', value: 'x' }]),
            ],
          },
        ] }],
      },
    ],
  } as never)

  it('keeps the flattening it already had', () => {
    expect(row(renderMarkdown(blocks))).toBe('| one two | x |')
  })
})

describe('the two controls', () => {
  it('leaves a hard break in a cell as <br>', () => {
    // §9a, and the reason the soft break needed its own clause: these are
    // different breaks and get different answers in the same slot.
    const hard = cellTable([
      { type: 'text', value: 'one' },
      { type: 'hard_break' },
      { type: 'text', value: 'two' },
    ])
    expect(row(renderMarkdown(hard))).toBe('| one<br>two | x |')
  })

  it('leaves a soft break OUTSIDE a cell as a newline', () => {
    expect(renderMarkdown(parse('one\ntwo'))).toBe('one\ntwo\n')
  })
})
