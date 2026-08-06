import { describe, expect, it } from 'vitest'
import { carveToAstJson, carveToHtml } from '../src/index.js'

/**
 * A leading byte order mark does not shift positions (carve#876).
 *
 * A single U+FEFF at the document start is stripped before parsing, so
 * `<BOM># T` is a heading. The strip used to slice the source and let the
 * parser index the SHORTENED string, so every offset in the document came back
 * one codepoint short of the file PART 12 §4 says positions index: `text` at
 * 2..3 was the space, where the node said `T`.
 *
 * All three engines did it the same way, and nothing could see it - the HTML is
 * identical either way, and no corpus document carries a BOM (carve#872).
 */
describe('a leading byte order mark', () => {
  const BOM = '\uFEFF'

  it('leaves every offset indexing the original source', () => {
    // The property stated as a consumer would use it: slice the ORIGINAL text
    // by a reported span and get the node's own characters back.
    const source = `${BOM}# T\n\nabc\n`
    const doc = carveToAstJson(source) as any
    const heading = doc.children[0]
    const paragraph = doc.children[1]

    expect(source.slice(heading.children[0].pos.startOffset, heading.children[0].pos.endOffset)).toBe('T')
    expect(source.slice(paragraph.children[0].pos.startOffset, paragraph.children[0].pos.endOffset)).toBe('abc')
  })

  it('puts the first line content one column in, since the mark occupies the first', () => {
    const doc = carveToAstJson(`${BOM}# T\n`) as any

    expect(doc.children[0].pos.startColumn).toBe(2)
  })

  it('leaves a document without a mark untouched', () => {
    // The control. Adding the offset unconditionally would shift every
    // document by one.
    const source = '# T\n\nabc\n'
    const doc = carveToAstJson(source) as any

    expect(doc.children[0].pos.startColumn).toBe(1)
    expect(source.slice(doc.children[0].children[0].pos.startOffset, doc.children[0].children[0].pos.endOffset)).toBe('T')
  })

  it('still strips the mark for parsing', () => {
    // The boundary the offset fix must not undo: the heading is still a
    // heading, not literal text.
    expect(carveToHtml(`${BOM}# T\n`)).toBe(carveToHtml('# T\n'))
  })

  it('leaves a mark that is not at the document start as content', () => {
    // A U+FEFF elsewhere is an ordinary zero-width character, so nothing is
    // stripped and nothing shifts.
    const source = `a${BOM}b\n`
    const doc = carveToAstJson(source) as any

    expect(source.slice(doc.children[0].children[0].pos.startOffset, doc.children[0].children[0].pos.endOffset)).toBe(`a${BOM}b`)
  })

  it('is not the only normalization that used to shift them', () => {
    // CRLF is the same defect through the other half of the normalization: the
    // parser counted `+1` per line ending where `\r\n` is two characters, so
    // every span landed one character early per preceding line. Fixing the BOM
    // alone left this (carve#876).
    const source = '# T\r\n\r\nabc\r\n'
    const doc = carveToAstJson(source) as any

    expect([...source].slice(doc.children[1].children[0].pos.startOffset, doc.children[1].children[0].pos.endOffset).join('')).toBe('abc')
  })

  it('handles a lone carriage return the same way', () => {
    const source = '# T\r\rabc\r'
    const doc = carveToAstJson(source) as any

    expect([...source].slice(doc.children[1].children[0].pos.startOffset, doc.children[1].children[0].pos.endOffset).join('')).toBe('abc')
  })
})
