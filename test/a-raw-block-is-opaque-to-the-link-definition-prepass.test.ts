import { describe, expect, it } from 'vitest'
import { carveToCarve, carveToHtml, parse, toAstJson } from '../src/index.js'

const B = '```'
const topTypes = (source: string): string[] =>
  toAstJson(parse(source)).children.map((child) => child.type)

// `collectLinkDefs` tracked only `RE_FENCE`, whose language slot excludes `=`,
// so a raw block's ```` ```=FORMAT ```` opener went unrecognized and the CLOSER
// was read as an opener instead. Everything after a raw block then counted as
// fence interior, and the fence never closed.
describe('a raw block is opaque to the link-definition prepass', () => {
  it('collects a definition written after a raw block', () => {
    const source = `${B}=html\n<b>x</b>\n${B}\n\n[r]: /d\n`
    expect(topTypes(source)).toEqual(['raw_block', 'link_reference_definition'])
  })

  it('keeps collecting past the blocks that follow a raw block', () => {
    const source = `${B}=html\n<b>x</b>\n${B}\n\npara\n\n[r]: /d\n\nmore\n`
    // The definition hoists to the end of the document (PART 12 section 10), so
    // it lands after both paragraphs rather than where it was authored.
    expect(topTypes(source)).toEqual([
      'raw_block',
      'paragraph',
      'paragraph',
      'link_reference_definition',
    ])
  })

  it('does not collect a definition written INSIDE a raw block', () => {
    // The dangerous direction: raw content is passthrough, so a definition in it
    // must not reach the link table. It did, and a reference below resolved
    // against opaque content.
    const source = `${B}=html\n[r]: /d\n${B}\n\nsee [x][r]\n`
    expect(topTypes(source)).toEqual(['raw_block', 'paragraph'])
    expect(carveToHtml(source)).toBe('[r]: /d\n<p>see [x][r]</p>')
  })

  it('tracks a tilde-delimited raw block the same way', () => {
    const source = '~~~=html\n<b>x</b>\n~~~\n\n[r]: /d\n'
    expect(topTypes(source)).toEqual(['raw_block', 'link_reference_definition'])
  })

  it('satisfies parse(fmt(x)) == parse(x) when fmt moves a definition past a raw block', () => {
    // fmt writes definitions at the end of the document, which put this one in
    // the position the prepass could not read back: the writer emitted bytes its
    // own parser dropped (PART 11 section 1).
    const source = `[r]: /d\n\n${B}=html\n<b>x</b>\n${B}\n`
    expect(topTypes(carveToCarve(source))).toEqual(topTypes(source))
  })
})
