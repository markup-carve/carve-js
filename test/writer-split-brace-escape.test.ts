// The repair measures the nodes of a line one by one to find where the parse resumes. Measuring a node as a list of
// one placed the escapes of a list end, so a `{` before the next node took a backslash nothing asked for.
import { describe, expect, it } from 'vitest'
import { type DocumentNode, type Inline, parse, treesEqual, writeWithDiagnostics } from '../src/index.ts'
import { documentOf, paragraph, text } from './support/tree.ts'

const emDash: Inline = { type: 'smart_punctuation', kind: 'em_dash', glyph: '—', source: '---' }
const enDash: Inline = { type: 'smart_punctuation', kind: 'en_dash', glyph: '–', source: '--' }
const emphasis = (...children: Inline[]): Inline => ({ type: 'emphasis', children })
const strong = (...children: Inline[]): Inline => ({ type: 'strong', children })

function written(tree: DocumentNode): string {
  const output = writeWithDiagnostics(tree)
  expect(output.diagnostics).toEqual([])
  return output.source
}

describe('a brace at the end of a text node inside emphasis or strong', () => {
  it('takes no backslash when the text goes on in the next text node', () => {
    const split = documentOf(paragraph(emphasis(text('{'), text('-'), text('--'), text('-'))))
    expect(written(split)).toBe('/{-\\--\\-/\n')
    expect(written(documentOf(paragraph(emphasis(text('{----')))))).toBe('/{-\\--\\-/\n')
  })

  it('takes no backslash before a dash node', () => {
    const tree = documentOf(paragraph(strong(text('{'), text('>-'), enDash)))
    expect(written(tree)).toBe('*{>\\---*\n')
  })

  it('reads back as the tree it was written from', () => {
    const tree = documentOf(paragraph(emphasis(text('{'), emDash, text('}--')), emDash, text('-->#]-'), emphasis(text('#'))))
    const source = written(tree)
    expect(source).toBe('/\\{---}-\\-/---\\-\\->#]-/#/\n')
    expect(treesEqual(parse(source), tree)).toBe(true)
  })
})
