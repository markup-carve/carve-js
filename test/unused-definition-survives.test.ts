import { describe, it, expect } from 'vitest'
import { carveToMarkdown, carveToPlainText, carveToAnsi, carveToCarve } from '../src/index.js'

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

describe('a footnote definition with an EMPTY label', () => {
  // `[^]: %` is the clause's own example. carve-js used to require at least one
  // label character, so this line fell through to the link-definition rule,
  // which captured `^` as a reference label and consumed it - the construct
  // vanished from every target, HTML included. `[^ ]: x` already produced a
  // footnote with an empty label, so the two spellings disagreed.
  it('is a footnote definition, not a link definition', () => {
    expect(carveToMarkdown('[^]: %\n')).toBe('[^]: %\n')
    expect(carveToPlainText('[^]: %\n')).toBe('[^]: %\n')
  })

  it('keeps its caret - the marker is emitted as written', () => {
    // `[]: %` is a LINK reference definition; emitting one where the author
    // wrote a footnote turns a definition into a different construct.
    expect(carveToMarkdown('[^]: %\n')).toContain('[^]')
    expect(plain(carveToAnsi('[^]: %\n'))).toContain('[^]')
  })

  it('survives a formatter round trip', () => {
    expect(carveToCarve('[^]: %\n')).toBe('[^]: %\n')
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
