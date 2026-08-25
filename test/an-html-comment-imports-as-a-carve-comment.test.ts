/*
 * AN HTML COMMENT IMPORTS AS A CARVE COMMENT (markup-carve/carve#1709).
 *
 * It was dropped in every mode with nothing reported. The usual reason this
 * importer drops something is that Carve has no spelling for the shape - and
 * that reason never applied here, because CARVE HAS COMMENTS. So the drop was
 * a choice to lose bytes the format can hold, in the mode whose whole job is
 * fidelity, and it was a choice nobody had made: no clause anywhere named it.
 *
 * THE POSITION DECIDES THE SPELLING AND THE COMMENT IS NOT RELOCATED. Among
 * blocks it is a block comment, whose fence widens the way a code fence does,
 * so no payload can close it early. Inside an inline run it is the delimited
 * form, and two payloads close THAT early: text holding the closer, and text
 * holding a blank line, which ends the paragraph the run is in. Those are
 * dropped with one row saying so, rather than truncated or escaped into the
 * form - a comment that came back shorter, or carrying characters the author
 * did not write, is a silent content change.
 */
import { describe, expect, it } from 'vitest'
import { htmlToCarve } from '../src/index.js'

const MODES = ['safe', 'semantic', 'roundtrip'] as const

function everyMode(html: string): Array<{ value: string; codes: string[] }> {
  return MODES.map((mode) => {
    const result = htmlToCarve(html, { mode })
    return { value: result.value, codes: result.report.diagnostics.map((entry) => entry.code) }
  })
}

describe('an HTML comment imports as a Carve comment', () => {
  it('keeps a comment between two blocks, as a block comment, in every mode', () => {
    for (const { value, codes } of everyMode('<p>a</p><!--note--><p>b</p>')) {
      expect(value).toBe('a\n\n%%%\nnote\n%%%\n\nb\n')
      // Nothing was lost, so nothing is said.
      expect(codes).toEqual([])
    }
  })

  it('keeps a comment inside a run, as the delimited inline comment', () => {
    for (const { value, codes } of everyMode('<p>a<!--note-->b</p>')) {
      expect(value).toBe('a{% note %}b\n')
      expect(codes).toEqual([])
    }
  })

  it('does not split the run a comment sits in', () => {
    // THE TWO POSITIONS TOLD APART. A run that also carries text is a real
    // inline run: emitting the comment as a block here would put the words
    // either side of it into two paragraphs, which is the document saying
    // something it never said.
    for (const { value } of everyMode('<div>text <!--n--> more</div>')) {
      expect(value).toBe('text {% n %} more\n')
    }
  })

  it('reads the pretty-printer whitespace around a comment as layout, not content', () => {
    // Otherwise the answer would depend on whether the author indented their
    // HTML: the same comment would be a block one in a minified document and
    // an inline one in a formatted one.
    for (const { value } of everyMode('<p>a</p>\n<!--n-->\n<p>b</p>')) {
      expect(value).toBe('a\n\n%%%\nn\n%%%\n\nb\n')
    }
  })

  it('keeps a comment that is the whole document', () => {
    for (const { value, codes } of everyMode('<!--note-->')) {
      expect(value).toBe('%%%\nnote\n%%%\n')
      expect(codes).toEqual([])
    }
  })

  it('keeps a multi-line comment whole', () => {
    for (const { value, codes } of everyMode('<!--multi\nline\ncomment-->')) {
      expect(value).toBe('%%%\nmulti\nline\ncomment\n%%%\n')
      expect(codes).toEqual([])
    }
  })

  it('widens the block fence past a payload that is itself a fence line', () => {
    // The reason the BLOCK form has no unspellable case: the writer widens, so
    // no payload can close the fence early.
    for (const { value, codes } of everyMode('<!--%%%%-->')) {
      expect(value).toBe('%%%%%\n%%%%\n%%%%%\n')
      expect(codes).toEqual([])
    }
  })

  it('drops an inline comment whose text holds the closer, and says so', () => {
    // `{% has %} in %}` re-reads as a comment saying `has` followed by the
    // prose ` in %}`, so the document would come back saying something the
    // author never wrote. Refused loudly instead.
    for (const { value, codes } of everyMode('<p>a<!--has %} in-->b</p>')) {
      expect(value).toBe('ab\n')
      expect(codes).toEqual(['element-dropped'])
    }
    const report = htmlToCarve('<p>a<!--has %} in-->b</p>', { mode: 'roundtrip' }).report
    expect(report.diagnostics[0]).toMatchObject({
      code: 'element-dropped',
      severity: 'warning',
      path: '/p[1]/comment()[2]',
    })
    expect(report.diagnostics[0]!.message).toContain('holds the comment closer')
  })

  it('drops an inline comment whose text holds a blank line, and says so', () => {
    // A blank line ends the paragraph the run is in, so both halves come back
    // as prose and the comment is gone.
    for (const { value, codes } of everyMode('<p>a<!--x\n\ny-->b</p>')) {
      expect(value).toBe('ab\n')
      expect(codes).toEqual(['element-dropped'])
    }
    expect(htmlToCarve('<p>a<!--x\n\ny-->b</p>').report.diagnostics[0]!.message).toContain('holds a blank line')
  })

  it('keeps an inline comment carrying a single newline, which is only a soft wrap', () => {
    // NOT one of the two unspellable payloads, and worth pinning apart from
    // them: a single newline inside the run is a soft wrap, so the comment
    // re-reads intact and refusing it would be a loss with no cause.
    for (const { value, codes } of everyMode('<p>a<!--x\ny-->b</p>')) {
      expect(value).toBe('a{% x\ny %}b\n')
      expect(codes).toEqual([])
    }
  })

  it('does not relocate an unspellable inline comment into the block form', () => {
    /*
     * Moving it would put text somewhere the author did not write it, and
     * `roundtrip` reading its own output would then find the document had
     * moved. The row is the answer, not a relocation.
     *
     * THE DOCUMENT CARRIES A SPELLABLE BLOCK COMMENT TOO, and that is what
     * makes this an assertion rather than a formality: `not.toContain('%%%')`
     * on the unspellable comment alone passes for an engine that never wrote a
     * block comment in its life. Here the block form IS reached and written,
     * so the only way the inline one could appear beside it is a relocation.
     */
    const { value, report } = htmlToCarve('<!--block--><p>a<!--has %} in-->b</p>', { mode: 'roundtrip' })
    expect(value).toBe('%%%\nblock\n%%%\n\nab\n')
    expect(value).not.toContain('has')
    expect(report.diagnostics.map((entry) => entry.code)).toEqual(['element-dropped'])
  })

  it('leaves a comment inside preserved raw bytes alone', () => {
    // It reaches the output with the element, so there is nothing to import
    // and nothing to report about it.
    const result = htmlToCarve('<form onclick="x()"><!--kept--></form>', { mode: 'roundtrip' })
    expect(result.value).toContain('<!--kept-->')
    expect(result.report.diagnostics.map((entry) => entry.code)).toEqual(['attribute-preserved', 'raw-preserved'])
  })
})
