import { describe, it, expect } from 'vitest'
import { carveToHtml } from '../src/index.js'

/*
 * PART 1 S4: NO OPEN PARAGRAPH, NO LAZY LINE.
 *
 * `- >` opens an item whose content is an EMPTY block quote. A following
 * column-0 line supplies no container prefix and has no open paragraph
 * anywhere in the stack to fold into, so the item closes and the line is a new
 * top-level block. `- > q` + the same line FOLDS, because there the quote does
 * hold an open paragraph - one rule, opposite answers.
 *
 * The grammar names this engine as one of the two that kept the line inside the
 * item (carve#561, carve#572).
 */
describe('a list item whose only content is an empty quote', () => {
  // Collapse only the indentation BETWEEN tags: a newline inside text is
  // content (a soft break), and flattening it would hide what folded where.
  const norm = (html: string) => html.replace(/>\n\s*/g, '>').replace(/\n\s*</g, '<')

  it('closes on a following column-0 line', () => {
    expect(norm(carveToHtml('- >\nlazy\n'))).toBe(
      '<ul><li><blockquote></blockquote></li></ul><p>lazy</p>',
    )
  })

  it('closes on a column-0 line after a bare-dot marker too', () => {
    expect(norm(carveToHtml('. >\nX\n'))).toBe(
      '<ol><li><blockquote></blockquote></li></ol><p>X</p>',
    )
  })

  it('closes whatever the following line looks like', () => {
    for (const lead of ['*', '|', '#', '1.']) {
      expect(norm(carveToHtml(`. >\n${lead}\n`))).toContain('</ol>')
      expect(norm(carveToHtml(`. >\n${lead}\n`))).not.toMatch(/<li>[\s\S]*lazy/)
    }
  })

  it('still folds when the quote holds a paragraph', () => {
    expect(norm(carveToHtml('- > q\nlazy\n'))).toBe(
      '<ul><li><blockquote><p>q\nlazy</p></blockquote></li></ul>',
    )
  })

  it('still folds a nested quote that holds a paragraph', () => {
    expect(norm(carveToHtml('- > > q\nlazy\n'))).toContain('q\nlazy')
  })

  it('closes when the nested quote is empty', () => {
    expect(norm(carveToHtml('- > >\nlazy\n'))).toContain('</ul><p>lazy</p>')
  })
})
