import { describe, expect, it } from 'vitest'
import { carveToMarkdown } from '../src/index.js'

/**
 * carve-js#1705, the third rule in this writer after the padding family
 * (carve-js#1684, carve-js#1688).
 *
 * A delimiter run only CLOSES emphasis while it is right-flanking and only
 * OPENS it while it is left-flanking (CommonMark 6.2). A run whose inner
 * neighbour is punctuation needs an outer neighbour that is whitespace or
 * punctuation; against an alphanumeric it can do neither, and the emphasis
 * reaches the reader as literal text. Unlike the padding family this needs no
 * padding at all - what decides it is the SIBLING across the seam, so it is
 * answered where the siblings are joined and nowhere else.
 *
 * Read back with markdown-it-py 3.0.0, `commonmark` preset with the
 * `strikethrough` rule ENABLED - the default preset has GFM strikethrough off,
 * which makes every `~~` row read literal for an unrelated reason.
 */
describe('a closing run that cannot close falls back to inline HTML', () => {
  it('re-spells strong when the content ends in punctuation and a letter follows', () => {
    expect(carveToMarkdown('a {*x!*}b\n')).toBe('a <strong>x!</strong>b\n')
  })

  it('re-spells emphasis in the same seam', () => {
    expect(carveToMarkdown('a {/x!/}b\n')).toBe('a <em>x!</em>b\n')
  })

  it('re-spells strike in the same seam', () => {
    expect(carveToMarkdown('a {~x!~}b\n')).toBe('a <del>x!</del>b\n')
  })

  it('answers the same way for a digit across the seam', () => {
    expect(carveToMarkdown('a {*x!*}1\n')).toBe('a <strong>x!</strong>1\n')
  })

  it('answers the same way for a closing bracket as the inner neighbour', () => {
    expect(carveToMarkdown('a {*x)*}b\n')).toBe('a <strong>x)</strong>b\n')
  })
})

describe('an opening run that cannot open falls back too', () => {
  it('re-spells strong when the content starts with punctuation after a letter', () => {
    expect(carveToMarkdown('a{*!x*}b\n')).toBe('a<strong>!x</strong>b\n')
  })

  it('re-spells emphasis in the same seam', () => {
    expect(carveToMarkdown('a{/!x/}b\n')).toBe('a<em>!x</em>b\n')
  })

  it('re-spells strike in the same seam', () => {
    expect(carveToMarkdown('a{~!x~}b\n')).toBe('a<del>!x</del>b\n')
  })
})

/**
 * The sentinels stand for `_`, `#` and `[` until `resolveNarrowedEscapes` runs,
 * and they are private-use code points that no punctuation property matches. A
 * flanking test that asked about the carrier instead of the character it stands
 * for would read these three as ordinary letters and leave the dead run in.
 */
describe('a sentinel is tested as the character it stands for', () => {
  it('sees the underscore behind its carrier', () => {
    expect(carveToMarkdown('a {*x_*}b\n')).toBe('a <strong>x_</strong>b\n')
  })

  it('sees the hash behind its carrier', () => {
    expect(carveToMarkdown('a {*x#*}b\n')).toBe('a <strong>x#</strong>b\n')
  })

  it('sees the bracket behind its carrier', () => {
    expect(carveToMarkdown('a {*x[*}b\n')).toBe('a <strong>x[</strong>b\n')
  })
})

/**
 * The punctuation class is CommonMark 0.31's - ASCII punctuation plus Unicode
 * P* AND S*. 0.30 left the symbol categories out, so the two versions disagree
 * about `©`: a 0.30 reader closes the run, a 0.31 reader does not. Taking the
 * wider class is the answer that is right under both, because inline HTML reads
 * the same way everywhere.
 */
describe('the punctuation class takes the Unicode symbol categories', () => {
  it('treats a symbol as punctuation, which `\\p{P}` alone would not', () => {
    expect(carveToMarkdown('a {*x©*}b\n')).toBe('a <strong>x©</strong>b\n')
  })
})

/**
 * Every seam whose outer character already flanks keeps its delimiters. These
 * are the rows that would go red if the repair fired on the content edge alone,
 * which is the cheap wrong version of this fix.
 */
describe('a run that can flank keeps its delimiters', () => {
  it('keeps them against whitespace', () => {
    expect(carveToMarkdown('a {*x!*} b\n')).toBe('a **x!** b\n')
  })

  it('keeps them at the end of the input', () => {
    expect(carveToMarkdown('a {*x!*}\n')).toBe('a **x!**\n')
  })

  it('keeps them against punctuation', () => {
    expect(carveToMarkdown('a {*x!*}, b\n')).toBe('a **x!**, b\n')
  })

  it('keeps them against a code span, whose backtick is punctuation', () => {
    expect(carveToMarkdown('a {*x!*}`c`\n')).toBe('a **x!**`c`\n')
  })

  it('keeps them when the content does not end in punctuation', () => {
    expect(carveToMarkdown('a {*x*}b\n')).toBe('a **x**b\n')
  })

  it('keeps them for a nested run whose neighbour is the outer delimiter', () => {
    expect(carveToMarkdown('a {*x {/y!/}*}b\n')).toBe('a <strong>x *y!*</strong>b\n')
  })
})

/**
 * The six wrapper lines build their run at the call site. They need no repair:
 * a wrapper's neighbours are the start of its own line and the newline after
 * it, and both of those flank. Pinning it so a later change to the repair does
 * not quietly start rewriting titles.
 */
describe('a wrapper line keeps its run', () => {
  it('leaves a definition term ending in punctuation as a delimiter run', () => {
    expect(carveToMarkdown(':: term!\n: body\n')).toContain('**term!**')
  })

  it('leaves a definition term starting with punctuation as a delimiter run', () => {
    expect(carveToMarkdown(':: !term\n: body\n')).toContain('**!term**')
  })
})
