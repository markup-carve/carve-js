import { describe, expect, it } from 'vitest'
import { carveToCarve, carveToHtml, markdownToCarve } from '../src/index.js'

/**
 * A blank line inside a quote separates two of its blocks and `carve fmt`
 * writes it; one the quote never comes back from carries nothing, and fmt drops
 * it the way it drops a trailing blank in any container. The import wrote it
 * wherever the source had one, so an imported document holding one failed
 * `fmt --check` (markup-carve/carve-js#1947 case 2).
 *
 * The reading decides whether one goes, because dropping it reopens the
 * paragraph above for a lazy line. Every case here asserts the bytes AND that
 * `carveToCarve` leaves them alone.
 */
const sp = (n: number): string => ' '.repeat(n)
const lines = (...rows: string[]): string => rows.join('\n') + '\n'
const fixedPoint = (out: string): string => {
  expect(carveToCarve(out)).toBe(out)
  return out
}

describe('an empty quote line the quote ends at is not written', () => {
  it('drops one at the end of the document', () => {
    expect(fixedPoint(markdownToCarve(lines('> alpha', '>')))).toBe(lines('> alpha'))
  })

  it('drops one the quote does not come back from', () => {
    expect(fixedPoint(markdownToCarve(lines('> alpha', '>', '', 'tail')))).toBe(lines('> alpha', '', 'tail'))
  })

  it('drops one at a nested quote depth', () => {
    expect(fixedPoint(markdownToCarve(lines('> > alpha', '> >')))).toBe(lines('> > alpha'))
  })

  it('drops a run of them from the end', () => {
    // Dropping the last leaves the one above it trailing in turn.
    const out = fixedPoint(markdownToCarve(lines('- > alpha', sp(2) + '>', sp(2) + '>', sp(6) + 'code')))
    expect(out).toBe(lines('- > alpha', sp(2) + '```', sp(2) + 'code', sp(2) + '```'))
  })

  it('keeps one the quote comes back from', () => {
    // Here it separates two paragraphs of the quote, and fmt writes it.
    expect(fixedPoint(markdownToCarve(lines('> alpha', '>', '> beta')))).toBe(lines('> alpha', '>', '> beta'))
  })

  it('keeps the one fmt writes before a deeper quote', () => {
    // fmt separates a quote's paragraph from a nested quote under it with this
    // line (markup-carve/carve-js#1921), and both spellings read alike, so the
    // reading check cannot be what keeps it.
    expect(fixedPoint(markdownToCarve(lines('> alpha', '>', '> >')))).toBe(lines('> alpha', '>', '> >'))
    expect(fixedPoint(markdownToCarve(lines('> alpha', '>', '> > beta')))).toBe(lines('> alpha', '>', '> > beta'))
  })

  it('drops one the deeper quote itself ends at', () => {
    expect(fixedPoint(markdownToCarve(lines('> > alpha', '> >')))).toBe(lines('> > alpha'))
    expect(fixedPoint(markdownToCarve(lines('> > alpha', '> >', '>')))).toBe(lines('> > alpha'))
  })

  it('keeps the one an empty quote is made of', () => {
    expect(fixedPoint(markdownToCarve(lines('>')))).toBe(lines('>'))
  })

  it('keeps a quote-shaped line that is code, not a quote', () => {
    // Inside a fence the line is the sample's own bytes, and the reading says
    // so: this is what the reading check is there to catch.
    const out = fixedPoint(markdownToCarve(lines('```', '> a', '>', '```')))
    expect(out).toBe(lines('```', '> a', '>', '```'))
  })

  it('keeps every one of them past the parse budget', () => {
    // More candidates than `TRAILING_QUOTE_LINE_PARSE_BUDGET`, so the one-at-a-
    // time pass does not run; they are all code and all have to stay either way.
    const body = Array.from({ length: 40 }, () => ['> a', '>']).flat()
    const out = fixedPoint(markdownToCarve(lines('```', ...body, '```')))
    expect(out.split('\n').filter((line) => line.trim() === '>')).toHaveLength(40)
  })

  it('keeps the reading of what follows the quote', () => {
    // cmark-gfm: a blockquote, then a code block beside it.
    const out = fixedPoint(markdownToCarve(lines('> alpha', '>', '>' + sp(5) + 'code')))
    expect(out).toBe(lines('> alpha', '>', '> ```', '> code', '> ```'))
    expect(carveToHtml(out)).toMatch(/<blockquote>[\s\S]*<pre><code>code/)
  })
})
