import { describe, expect, it } from 'vitest'
import { carveToHtml, parse, renderCarve } from '../src/index.js'

/*
 * A PERCENT-LEADING COMMENT LINE KEEPS ITS SEPARATOR (markup-carve/carve-js#1674).
 *
 * The block arm writes `%% ${content}` unconditionally, so a comment whose
 * content opens with a percent comes back with a SHORTER marker run than the
 * source had: `%%%` is written `%% %`. The ticket read that as a defect and
 * asked for the inline arm's rule (carve#581, carve#544), which joins the run
 * instead of separating it.
 *
 * IT IS THE OPPOSITE OF A DEFECT AT BLOCK LEVEL. The comment-LINE marker is
 * exactly `%%`; a run of three or more is a comment FENCE (PART 9 §28). So the
 * separator is the only thing keeping the written line a LINE, and joining it
 * would emit a fence that pairs with any later run of the same width and hides
 * the document between them. The last describe below is that measurement.
 *
 * The content is not lost either way - §28 degrades an unterminated fence to
 * one `%%` line comment, and corpus section 445 (carve#1903, ported at
 * carve-js#1607) pins BOTH spellings to the same document at every column. So
 * `%% %` is a faithful spelling of what the AST holds, not a lossy one.
 */

/** Every shape whose comment content opens with a percent. */
const PERCENT_LEADING = [
  ['the reported document', '- - x\n  %%%\n  y\n'],
  ['at the nested content column', '- - x\n    %%%\n    y\n'],
  ['flat, alone', '%%%\n'],
  ['flat, with a follower', '%%%\ny\n'],
  ['a tail after the run', '%%%foo\n'],
  ['a tail behind a space', '%%% x\n'],
  ['a wider run', '%%%%\ny\n'],
  ['a widest run', '%%%%%\ny\n'],
  ['already in the separated spelling', '%% %\ny\n'],
  ['inside a single item', '- x\n  %%%\n  y\n'],
  ['inside a quote', '> x\n> %%%\n> y\n'],
  ['inside a div', ':::note\n%%%\ny\n:::\n'],
] as const

describe('the writer holds its round-trip invariant on a percent-leading comment', () => {
  // ONE ASSERTION PER ROW. A suite stops at the first failing expect, so the
  // rows after it would never be evaluated if they shared a test.
  it.each(PERCENT_LEADING)('reads back as the same document: %s', (_name, source) => {
    expect(carveToHtml(renderCarve(parse(source)))).toBe(carveToHtml(source))
  })

  it.each(PERCENT_LEADING)('is a writer fixed point: %s', (_name, source) => {
    const once = renderCarve(parse(source))

    expect(renderCarve(parse(once))).toBe(once)
  })

  it.each(PERCENT_LEADING)('keeps the comment content: %s', (_name, source) => {
    const contentOf = (src: string): string[] => {
      const out: string[] = []
      const walk = (n: any): void => {
        if (!n || typeof n !== 'object') return
        if (n.type === 'comment') out.push(n.content)
        for (const k of ['children', 'items']) if (Array.isArray(n[k])) n[k].forEach(walk)
      }
      walk(parse(src))
      return out
    }

    expect(contentOf(renderCarve(parse(source)))).toEqual(contentOf(source))
  })
})

describe('the written spelling', () => {
  // The two arms answer differently ON PURPOSE, because the two positions
  // grade the same run differently. Inline there is no fence to collide with,
  // so carve#581 joins; at block level there is, so this arm separates.
  it('separates the marker from the content at block level', () => {
    expect(renderCarve(parse('%%%\n'))).toBe('%% %\n')
  })

  it('joins the marker to the content inline, inside a line block', () => {
    expect(renderCarve(parse('| a\n| %% %\n| b\n'))).toBe('| a\n| %%%\n| b\n')
  })

  it('leaves a content that does not open with a percent alone', () => {
    expect(renderCarve(parse('%% z\n'))).toBe('%% z\n')
  })

  it('widens a block comment fence past the longest run in its content', () => {
    expect(renderCarve(parse('%%%%\n%%%\n%%%%\n'))).toBe('%%%%\n%%%\n%%%%\n')
  })
})

describe('why the separator cannot be dropped', () => {
  // THE MEASUREMENT THAT SETTLES THE TICKET. These two sources are the same
  // document - two comment lines with the content `%`, around a paragraph -
  // spelled with and without the separator. Only the separated spelling still
  // has the paragraph.
  it('the separated spelling publishes the paragraph between the comments', () => {
    expect(carveToHtml('%%%\nx\n%% %\n')).toBe('<p>x</p>')
  })

  it('the joined spelling pairs into a fence and hides it', () => {
    expect(carveToHtml('%%%\n\nx\n\n%%%\n')).toBe('')
  })

  it('so the writer never emits the joined spelling for that document', () => {
    expect(renderCarve(parse('%%%\nx\n%% %\n'))).not.toContain('\n%%%\n')
  })

  it('and the document survives the round trip', () => {
    expect(carveToHtml(renderCarve(parse('%%%\nx\n%% %\n')))).toBe('<p>x</p>')
  })
})
