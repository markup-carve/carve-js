import { describe, expect, it } from 'vitest'
import { carveToCarve, carveToHtml, markdownToCarve } from '../src/index.js'

/**
 * A blank line does not end an indented code block; only a non-blank line left
 * of its four columns does (CommonMark 4.4), and trailing blanks are not the
 * code's. Indented code on a QUOTED item's own marker line read the rule the
 * other way: the blank closed the code and ended the collector's run, so
 * `> -     a` over `>` over `>       b` came out as two code blocks where
 * cmark-gfm reads one (markup-carve/carve-js#1947).
 *
 * The unquoted twin has always been right, and is asserted beside each case so
 * a future divergence between the two shows up here.
 *
 * Readings measured through cmark-gfm 0.29.0.gfm.13.
 */
const sp = (n: number): string => ' '.repeat(n)
const lines = (...rows: string[]): string => rows.join('\n') + '\n'
const fixedPoint = (out: string): string => {
  expect(carveToCarve(out)).toBe(out)
  return out
}

describe('a blank line does not end indented code on a quoted item marker line', () => {
  it('keeps the blank the code comes back from', () => {
    // cmark-gfm: <li><pre><code>a\n\nb</code></pre></li> inside the quote.
    const out = fixedPoint(markdownToCarve(lines('> -' + sp(5) + 'a', '>', '>' + sp(7) + 'b')))
    expect(out).toBe(lines('> - ```', '>' + sp(3) + 'a', '>', '>' + sp(3) + 'b', '>' + sp(3) + '```'))
    expect(carveToHtml(out)).toMatch(/<pre><code>a\n\nb\n<\/code><\/pre>/)
  })

  it('reads the unquoted twin the same way', () => {
    const out = fixedPoint(markdownToCarve(lines('-' + sp(5) + 'a', '', sp(6) + 'b')))
    expect(carveToHtml(out)).toMatch(/<pre><code>a\n\nb\n<\/code><\/pre>/)
  })

  it('keeps every blank of a run', () => {
    const out = fixedPoint(markdownToCarve(lines('> -' + sp(5) + 'a', '>', '>', '>' + sp(7) + 'b')))
    expect(out).toBe(lines('> - ```', '>' + sp(3) + 'a', '>', '>', '>' + sp(3) + 'b', '>' + sp(3) + '```'))
    expect(carveToHtml(out)).toMatch(/<pre><code>a\n\n\nb\n<\/code><\/pre>/)
  })

  it('walks a long run of blanks once', () => {
    // The lookahead that decides whether the code comes back answers for the
    // whole run, not per line, so a run of a thousand is not quadratic.
    const blanks = Array.from({ length: 1000 }, () => '>')
    const out = markdownToCarve(lines('> -' + sp(5) + 'a', ...blanks, '>' + sp(7) + 'b'))
    expect(out.split('\n').filter((line) => line === '>')).toHaveLength(1000)
    expect(carveToHtml(out)).toMatch(/<pre><code>a\n{1001}b\n<\/code><\/pre>/)
  })

  it('leaves a trailing blank out of the code', () => {
    // cmark-gfm ends the code at `a` and reads `beta` as the quote's paragraph.
    const out = fixedPoint(markdownToCarve(lines('> -' + sp(5) + 'a', '>', '> beta')))
    expect(out).toBe(lines('> - ```', '>' + sp(3) + 'a', '>' + sp(3) + '```', '>', '> beta'))
    expect(carveToHtml(out)).toMatch(/<\/ul>[\s\S]*<p>beta<\/p>/)
  })

  it('ends the code at a deeper quote, which only looks blank', () => {
    // `> >` carries nothing once its own marker comes off, but it is a quote of
    // its own, not a blank line of the code. cmark-gfm: the item's code, then an
    // empty quote, then a code block beside the list.
    const out = markdownToCarve(lines('> -' + sp(5) + 'a', '> >', '>' + sp(7) + 'b'))
    expect(carveToHtml(out)).toMatch(/<pre><code>a\n<\/code><\/pre>[\s\S]*<blockquote>[\s\S]*<pre><code> {2}b\n<\/code><\/pre>/)
  })

  it('ends the code where the line after the blank is not four columns in', () => {
    // At the item's content column it is the item's paragraph, not its code.
    const out = fixedPoint(markdownToCarve(lines('> -' + sp(5) + 'a', '>', '>' + sp(3) + 'b')))
    expect(out).toBe(lines('> - ```', '>' + sp(3) + 'a', '>' + sp(3) + '```', '>', '>' + sp(3) + 'b'))
    expect(carveToHtml(out)).toMatch(/<pre><code>a\n<\/code><\/pre>[\s\S]*<p>b<\/p>/)
  })

  it('ends the code at the end of the quote', () => {
    const out = fixedPoint(markdownToCarve(lines('> -' + sp(5) + 'a', '>')))
    expect(out).toBe(lines('> - ```', '>' + sp(3) + 'a', '>' + sp(3) + '```'))
  })
})
