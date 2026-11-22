// C2-W-099, C2-W-090: the backslash of a construct's opener goes to the character of the source run, whatever
// text node holds it, so a split tree is written as the same text in one node (carve-js#5360).
import { describe, expect, it } from 'vitest'
import { type DocumentNode, type Inline, parse, treesEqual, writeWithDiagnostics } from '../src/index.ts'
import { documentOf, paragraph, text } from './support/tree.ts'

const enDash: Inline = { type: 'smart_punctuation', kind: 'en_dash', glyph: '–', source: '--' }
const emDash: Inline = { type: 'smart_punctuation', kind: 'em_dash', glyph: '—', source: '---' }

function written(tree: DocumentNode): string {
  const output = writeWithDiagnostics(tree)
  expect(output.diagnostics).toEqual([])
  expect(treesEqual(parse(output.source), tree)).toBe(true)
  return output.source
}

describe('an opener run split over text nodes', () => {
  it('escapes the second hyphen of a split run before an en dash', () => {
    expect(written(documentOf(paragraph(text('-'), text('-'), enDash)))).toBe('-\\---\n')
    expect(written(documentOf(paragraph(text('--'), enDash)))).toBe('-\\---\n')
  })

  it('escapes the second hyphen of a split run before an em dash', () => {
    expect(written(documentOf(paragraph(text('-'), text('--'), emDash)))).toBe('-\\-\\----\n')
    expect(written(documentOf(paragraph(text('---'), emDash)))).toBe('-\\-\\----\n')
  })

  it('writes a split run inside a quote and a list item as the joined one', () => {
    const quote = (...children: Inline[]): DocumentNode => documentOf({ type: 'block_quote', children: [paragraph(...children)] })
    expect(written(quote(text('-'), text('-'), enDash))).toBe(written(quote(text('--'), enDash)))
    const item = (...children: Inline[]): DocumentNode => documentOf({
      type: 'list', marker: { char: '-', kind: 'bullet' }, spacing: 'tight',
      children: [{ type: 'list_item', children: [paragraph(...children)] }],
    })
    expect(written(item(text('-'), text('--'), emDash))).toBe(written(item(text('---'), emDash)))
  })

  it('escapes the second hyphen of a split run inside strong', () => {
    const strong = (...children: Inline[]): DocumentNode => documentOf(paragraph({ type: 'strong', children }, text(' a')))
    expect(written(strong(text('-'), text('-->'), text('a')))).toBe(written(strong(text('--->'), text('a'))))
  })
})
