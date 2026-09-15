import { describe, expect, it } from 'vitest'
import { carveToMarkdown, fromAstJson, renderMarkdown } from '../src/index.js'

/**
 * carve-js#1710. GFM's strikethrough extension pairs a run of ONE OR TWO tildes,
 * so a literal tilde in a text node is a Markdown metacharacter and PART 11 §8
 * M1 escapes it. §8a narrows `_`, `#`, `[` and `<` and M1d leaves every other
 * metacharacter on M1, so the tilde takes no narrowing of its own.
 *
 * Unescaped, the reader does the pairing the writer never asked for: two literal
 * tildes anywhere in one paragraph close over whatever markup stands between
 * them and the tags interleave.
 *
 * Read back with markdown-it-py 3.0.0 (`commonmark` preset, `strikethrough`
 * enabled) and with pulldown-cmark 0.13.4 (ENABLE_STRIKETHROUGH). The two
 * readers disagree about the one-tilde form, which is why both are used.
 */
describe('a literal tilde in text is escaped', () => {
  it('escapes the pair that closes over the markup between it', () => {
    expect(carveToMarkdown('{_~~x_}{~y~}~~b\n')).toBe('<u>\\~\\~x</u>~~y~~\\~\\~b\n')
  })

  it('escapes a text pair at the start of a line', () => {
    expect(carveToMarkdown('~~{/x~~/}\n')).toBe('\\~\\~*x\\~\\~*\n')
  })

  it('escapes a single tilde too, which the one-tilde GFM form pairs', () => {
    expect(carveToMarkdown('a ~ b ~ c\n')).toBe('a \\~ b \\~ c\n')
  })

  it('escapes the tilde of a path, which is the cost of the rule', () => {
    expect(carveToMarkdown('~/home/user\n')).toBe('\\~/home/user\n')
  })

  it('escapes a tilde in a table cell, which is text like any other', () => {
    expect(carveToMarkdown('| a~~b |\n')).toBe('| a\\~\\~b |\n')
  })
})

/**
 * What the rule does NOT reach. A tilde that is not text is not covered by it:
 * the writer's own strike delimiters stay bare, code stays verbatim, and an
 * authored escape is already an escape under M2.
 */
describe('the tilde rule reaches text and nothing else', () => {
  it('leaves a strike delimiter the writer emitted alone', () => {
    expect(carveToMarkdown('{~x~}\n')).toBe('~~x~~\n')
  })

  it('leaves a tilde inside a code span alone', () => {
    expect(carveToMarkdown('a `x~~y` b\n')).toBe('a `x~~y` b\n')
  })

  it('leaves an authored escape as the escape M2 already makes of it', () => {
    expect(carveToMarkdown('a \\~ b\n')).toBe('a \\~ b\n')
  })
})

/**
 * The seam rule of carve-js#1706 still has a shape that reaches it. A run grown
 * by a tilde from TEXT cannot happen any more - M1 escapes that tilde before the
 * seam pass sees it - but a run grown by a NESTED STRIKE'S OWN delimiter can,
 * and that shape is unreachable from Carve source: a strike marker closes the
 * strike, so only the AST-JSON ingest can build a strike directly inside one.
 *
 * Without this row `contentGrowsRun` would be a check nothing can fire.
 */
describe('a nested strike still grows the run it sits in', () => {
  it('falls back to inline HTML for a strike whose first child is a strike', () => {
    const doc = fromAstJson({
      type: 'document',
      srcByteLength: 0,
      children: [
        {
          type: 'paragraph',
          children: [
            {
              type: 'strike',
              children: [{ type: 'strike', children: [{ type: 'text', value: 'y' }] }, { type: 'text', value: 'z' }],
            },
          ],
        },
      ],
    })

    expect(renderMarkdown(doc)).toBe('<del>~~y~~z</del>\n')
  })
})
