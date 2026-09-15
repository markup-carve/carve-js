import { describe, expect, it } from 'vitest'
import { carveToMarkdown } from '../src/index.js'

/**
 * carve-js#1706, the fourth rule in this writer after the padding family
 * (carve-js#1684, carve-js#1688) and flanking (carve-js#1705).
 *
 * Runs of the same character that TOUCH are one run to the reader, of their
 * summed length, and the length decides what that run can do. So the run the
 * writer emitted is not always the run the reader lexes, each half here is
 * individually well-flanked, and no flanking test can see the difference.
 *
 * Read back with markdown-it-py 3.0.0, `commonmark` preset with the
 * `strikethrough` rule ENABLED - the default preset has GFM strikethrough off,
 * which makes every `~~` row read literal for an unrelated reason.
 */
describe('a tilde in the content grows the strike run', () => {
  it('does not open a code fence at the start of a line', () => {
    expect(carveToMarkdown('{~~x~}\n')).toBe('<del>~x</del>\n')
  })

  it('answers the same way for a tilde at the end of the content', () => {
    expect(carveToMarkdown('{~x~~}\n')).toBe('<del>x~</del>\n')
  })

  it('answers the same way mid-line, where the run is not a fence', () => {
    expect(carveToMarkdown('a {~~x~}b\n')).toBe('a <del>~x</del>b\n')
  })

  it('takes the decision with no sibling to take it against', () => {
    expect(carveToMarkdown('{~~x~}')).toBe('<del>~x</del>\n')
  })
})

/**
 * The same fence, reached from the other side: two tildes of TEXT and a strike's
 * own two make a four-tilde run at the start of a line.
 */
describe('a tilde in the text grows the strike run too', () => {
  it('does not open a code fence at the start of a line', () => {
    expect(carveToMarkdown('~~{~x~}\n')).toBe('~~<del>x</del>\n')
  })

  it('re-spells a strike a single text tilde reaches', () => {
    expect(carveToMarkdown('a~{~x~}\n')).toBe('a~<del>x</del>\n')
  })

  it('re-spells it on the closing side as well', () => {
    expect(carveToMarkdown('{~x~}~b\n')).toBe('<del>x</del>~b\n')
  })
})

describe('two runs of the same length cannot both resolve', () => {
  it('re-spells the left of two adjacent emphases', () => {
    expect(carveToMarkdown('a {/x/}{/y/}\n')).toBe('a <em>x</em>*y*\n')
  })

  it('re-spells the left of two adjacent strongs', () => {
    expect(carveToMarkdown('a {*x*}{*y*}\n')).toBe('a <strong>x</strong>**y**\n')
  })

  it('walks a chain of three, leaving the last one spelled', () => {
    expect(carveToMarkdown('{/x/}{/y/}{/z/}\n')).toBe('<em>x</em><em>y</em>*z*\n')
  })
})

/**
 * The rule of 3 is the whole point of not converting on adjacency: these read
 * back correctly today and have to keep doing so.
 */
describe('a merged run the rule of 3 allows stays a delimiter run', () => {
  it('keeps strong against emphasis, which sums to three', () => {
    expect(carveToMarkdown('a {*x*}{/y/}\n')).toBe('a **x***y*\n')
  })

  it('keeps emphasis against strong, the same sum read the other way', () => {
    expect(carveToMarkdown('a {/x/}{*y*}\n')).toBe('a *x***y**\n')
  })

  it('keeps three against three, where both lengths are multiples of three', () => {
    expect(carveToMarkdown('{/{*x*}/}{/{*y*}/}\n')).toBe('***x******y***\n')
  })

  it('measures the run a nested delimiter lengthens, not the node\'s own width', () => {
    expect(carveToMarkdown('a {/{*x*}/}{/y/}\n')).toBe('a ***x****y*\n')
  })

  it('keeps two strikes, whose four-tilde run splits two and two', () => {
    expect(carveToMarkdown('a {~x~}{~y~}\n')).toBe('a ~~x~~~~y~~\n')
  })

  it('keeps a chain of three strikes for the same reason', () => {
    expect(carveToMarkdown('{~x~}{~y~}{~z~}\n')).toBe('~~x~~~~y~~~~z~~\n')
  })

  it('leaves a run a space separates from its neighbour alone', () => {
    expect(carveToMarkdown('a {/x/} {/y/}\n')).toBe('a *x* *y*\n')
  })

  it('reads the space the padding moved out of the run as ending it', () => {
    expect(carveToMarkdown('{/x /}{/y/}\n')).toBe('*x* *y*\n')
  })

  it('reads it the same way for a tilde run', () => {
    expect(carveToMarkdown('{~x ~}{~y~}\n')).toBe('~~x~~ ~~y~~\n')
  })

  it('leaves a strike a space separates from a text tilde alone', () => {
    expect(carveToMarkdown('{~x ~}~y\n')).toBe('~~x~~ ~y\n')
  })

  it('reads the space on the opening side the same way', () => {
    expect(carveToMarkdown('y~{~ x~}\n')).toBe('y~ ~~x~~\n')
  })

  it('leaves the inline-HTML kinds alone, which carry no run at all', () => {
    expect(carveToMarkdown('a {-x-}{-y-}\n')).toBe('a <del>x</del><del>y</del>\n')
  })
})

/**
 * Two ways the length arithmetic goes wrong if it counts raw characters.
 */
describe('the merged run is weighed against what the reader sees', () => {
  it('does not count an escaped asterisk as part of the run', () => {
    expect(carveToMarkdown('{/x*/}{/~y/}\n')).toBe('<em>x\\*</em>*~y*\n')
  })

  it('reads the merged run\'s flanking against the sibling\'s content', () => {
    expect(carveToMarkdown('{/x~/}{*y*}\n')).toBe('<em>x~</em>**y**\n')
  })

  it('applies that to a tilde seam as well', () => {
    expect(carveToMarkdown('{~x!~}{~y~}\n')).toBe('<del>x!</del>~~y~~\n')
  })
})
