import { describe, it, expect } from 'vitest'
import { markdownToCarve } from '../src/markdown-migrate.js'
import { carveToHtml } from '../src/index.js'

/**
 * Indented code a block quote holds is code, as it is at the top level.
 *
 * The four columns that make a line indented code are counted after the quote
 * marker, because that is where the quote's content starts. The importer
 * counted them from column 0, and a line beginning with `>` never has four, so
 * quoted code was never recognized at all (carve-js#1048): it came through as
 * quote prose, and Carve then read the sample's `*` and `_` as emphasis - the
 * same loss top-level indented code used to suffer, one container in.
 *
 * Every expectation was measured through `commonmark` and `marked`, never
 * through carve-js. Those readings are quoted in comments; what is asserted is
 * the reading they establish.
 *
 * Indentation is the SUBJECT here, so `sp()` builds every run of spaces rather
 * than any fixture pasting one, and `lines()` joins them.
 */
const sp = (n: number): string => ' '.repeat(n)
const lines = (...rows: string[]): string => rows.join('\n') + '\n'
// A quote marker plus the four columns that open code: `>`, the marker's own
// separating space, then four more.
const quotedCode = (text: string): string => '>' + sp(5) + text

describe('indented code inside a block quote', () => {
  it('builds its columns as bytes, not as a pasted literal', () => {
    // `>` (3e), five spaces (20 x5), `x` (78). A formatter that rewrote the
    // run would fail here rather than leave a passing test that tests nothing.
    expect(Buffer.from(quotedCode('x')).toString('hex')).toBe('3e' + '20'.repeat(5) + '78')
  })

  it('is a fence carrying the quote marker, not quoted prose', () => {
    // commonmark + marked: <blockquote><p>para</p><pre><code>code();
    // </code></pre></blockquote>
    const carve = markdownToCarve(lines('> para', '>', quotedCode('code();')))
    expect(carve).toBe(lines('> para', '>', '> ```', '> code();', '> ```'))
    const html = carveToHtml(carve)
    expect(html).toMatch(/<blockquote>[\s\S]*<pre><code>code\(\);/)
  })

  it('keeps the sample literal instead of reading it as emphasis', () => {
    // This is the loss the branch exists to prevent: as prose, `*not bold*`
    // became <strong>. commonmark keeps it inside <code>.
    const carve = markdownToCarve(lines('> para', '>', quotedCode('let x = *not bold*;')))
    const html = carveToHtml(carve)
    expect(html).toContain('let x = *not bold*;')
    expect(html).not.toContain('<strong>')
  })

  it('opens the quote when nothing precedes it', () => {
    // commonmark: <blockquote><pre><code>code();</code></pre></blockquote>
    const carve = markdownToCarve(lines(quotedCode('code();')))
    expect(carve).toBe(lines('> ```', '> code();', '> ```'))
    expect(carveToHtml(carve)).toMatch(/<blockquote>[\s\S]*<pre>/)
  })

  it('is NOT code when it lazily continues quoted prose', () => {
    // No blank quote line, so commonmark reads one paragraph: an indented code
    // block cannot interrupt a paragraph. Both readers agree.
    const carve = markdownToCarve(lines('> para', quotedCode('not code')))
    expect(carve).toBe(lines('> para', '>' + sp(5) + 'not code'))
    expect(carveToHtml(carve)).not.toContain('<pre>')
  })

  it('keeps its depth in a nested quote', () => {
    const carve = markdownToCarve(lines('> > para', '> >', '> >' + sp(5) + 'code();'))
    expect(carve).toBe(lines('> > para', '> >', '> > ```', '> > code();', '> > ```'))
    expect(carveToHtml(carve)).toMatch(/<blockquote>[\s\S]*<blockquote>[\s\S]*<pre>/)
  })

  it('carries a blank line through the sample, since a blank does not end it', () => {
    const carve = markdownToCarve(
      lines('> para', '>', quotedCode('a();'), '>', quotedCode('b();')),
    )
    expect(carve).toBe(lines('> para', '>', '> ```', '> a();', '>', '> b();', '> ```'))
    expect(carveToHtml(carve)).toContain('a();\n\nb();')
  })

  it('gives a trailing blank quote line back to the quote', () => {
    // The blank and `tail` belong to the quote, not to the sample.
    const carve = markdownToCarve(lines('> para', '>', quotedCode('a();'), '>', '> tail'))
    expect(carve).toBe(lines('> para', '>', '> ```', '> a();', '> ```', '>', '> tail'))
    const html = carveToHtml(carve)
    expect(html).toContain('<code>a();')
    expect(html).not.toContain('<code>a();\n\n')
  })

  it('keeps indentation past the fourth column as the samples own', () => {
    // commonmark strips exactly four columns; the rest is the code's.
    const carve = markdownToCarve(lines('> para', '>', '>' + sp(9) + 'deep();'))
    expect(carve).toBe(lines('> para', '>', '> ```', '>' + sp(5) + 'deep();', '> ```'))
    expect(carveToHtml(carve)).toContain('<code>' + sp(4) + 'deep();')
  })

  it('widens the fence when the sample holds backticks', () => {
    const carve = markdownToCarve(lines('> para', '>', quotedCode('a = `x`;')))
    expect(carve).toBe(lines('> para', '>', '> ```', '> a = `x`;', '> ```'))
    expect(carveToHtml(carve)).toContain('a = `x`;')
  })

  it('re-bases to the list item column when the quote is inside an item', () => {
    // Both container columns at once: the item's two, then the quote's marker.
    const carve = markdownToCarve(
      lines('- item', '', sp(2) + '> para', sp(2) + '>', sp(2) + quotedCode('code();')),
    )
    expect(carve).toBe(
      lines(
        '- item',
        '',
        sp(2) + '> para',
        sp(2) + '>',
        sp(2) + '> ```',
        sp(2) + '> code();',
        sp(2) + '> ```',
      ),
    )
    expect(carveToHtml(carve)).toMatch(/<li>[\s\S]*<blockquote>[\s\S]*<pre>/)
  })

  describe('controls', () => {
    it('leaves a quoted fenced code block alone', () => {
      const md = lines('> para', '>', '> ```', '> x', '> ```')
      expect(markdownToCarve(md)).toBe(md)
    })

    it('leaves a quote continuation three columns past the marker as prose', () => {
      const carve = markdownToCarve(lines('> para', '>', '>' + sp(4) + 'not code'))
      expect(carveToHtml(carve)).not.toContain('<pre>')
    })

    it('still reads a quoted HTML block as a raw block', () => {
      // The HTML branch from carve-js#1045 is the narrower match and runs first.
      const carve = markdownToCarve(lines('> quoted', '>', '> <footer>x</footer>'))
      expect(carve).toBe(lines('> quoted', '>', '> ```=html', '> <footer>x</footer>', '> ```'))
    })

    it('leaves an ordinary quote paragraph alone', () => {
      const md = lines('> para', '>', '> more')
      expect(markdownToCarve(md)).toBe(md)
    })
  })
})
