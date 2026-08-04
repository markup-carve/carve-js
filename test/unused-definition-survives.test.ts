import { describe, it, expect } from 'vitest'
import { carveToMarkdown, carveToPlainText, carveToAnsi, carveToCarve, carveToHtml } from '../src/index.js'
import { carveToAstJson } from '../src/index.js'

/*
 * PART 10 §10a: an unused definition survives the non-HTML targets.
 *
 * "HTML drops it, because HTML has nowhere to put a definition nobody used;
 * the other three do not get to drop content the author wrote." Dropping it
 * also makes the output depend on whether a reference exists elsewhere, so
 * adding one reference changes an unrelated line.
 *
 * Two of the three constructs are here. A LINK reference definition is not: it
 * leaves no node in the tree at all, so no renderer can emit it - the
 * vocabulary would need a node type first (carve#592).
 */
const plain = (text: string) => text.replace(/\[[\d;]*m/g, '')

describe('an abbreviation definition nothing references', () => {
  it('survives the markdown target', () => {
    expect(carveToMarkdown('*[AB]: expansion\n')).toContain('*[AB]: expansion')
  })

  it('survives the plain target', () => {
    expect(carveToPlainText('*[AB]: expansion\n')).toContain('*[AB]: expansion')
  })

  it('survives the terminal target', () => {
    expect(plain(carveToAnsi('*[AB]: expansion\n'))).toContain('*[AB]: expansion')
  })

  it('survives beside the text that uses it', () => {
    // A USED abbreviation still expands in the body - this target writes it as
    // an <abbr> - and the definition line is emitted as well, so the output no
    // longer depends on whether a reference exists.
    const md = carveToMarkdown('*[AB]: expansion\n\nAB here.\n')
    expect(md).toContain('*[AB]: expansion')
    expect(md).toContain('expansion">AB</abbr> here.')
  })
})

describe('an EMPTY footnote label is not a footnote at all', () => {
  // `footnote_label` is one-or-more characters, so `[^]: /x` is a LINK
  // reference definition whose label is `^`.
  //
  // This file briefly asserted the opposite, on PART 11 §10a's then-example
  // `[^]: %`. The clause has since withdrawn that example for this exact
  // reason, and §10a covers only the definition kinds that HAVE a node - a link
  // reference definition does not. Building a footnote made the non-HTML
  // targets emit `[^]: %` where carve-rs and carve-php emit nothing, which
  // looked like §10a compliance and was its opposite (carve#589, carve-js#631).
  it('registers a link reference labeled `^`', () => {
    expect(carveToHtml('[^]: /x\n\nsee [^][]\n')).toBe('<p>see <a href="/x">^</a></p>')
  })

  it('leaves no node in the tree', () => {
    expect(carveToAstJson('[^]: /x\n').children).toEqual([])
  })

  it('emits nothing on the non-HTML targets, like every link definition', () => {
    expect(carveToMarkdown('[^]: %\n').trim()).toBe('')
    expect(carveToPlainText('[^]: %\n').trim()).toBe('')
  })

  it('a label of one SPACE is still a footnote', () => {
    // `[^ ]: x` has a one-character label, so the one-or-more rule is met and
    // this stays a footnote - the boundary the empty case sits just below.
    expect(carveToAstJson('[^ ]: x\n').children.map((b) => b.type)).toEqual(['footnote'])
  })
})

describe('a footnote definition keeps its marker', () => {
  it('on the plain target', () => {
    expect(carveToPlainText('[^n]: a note\n')).toContain('[^n]:')
  })

  it('on the terminal target', () => {
    expect(plain(carveToAnsi('[^n]: a note\n'))).toContain('[^n]')
  })

  it('and on markdown, which already did', () => {
    expect(carveToMarkdown('[^n]: a note\n')).toContain('[^n]: a note')
  })
})
