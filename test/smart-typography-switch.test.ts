import { describe, it, expect } from 'vitest'
import { carveToHtml } from '../src/index.js'

/**
 * The document-global smart-typography switch (grammar PART 9 §8, optional
 * off switch; markup-carve/carve#560).
 *
 * Turning it off is a RENDERING decision, not a parsing one: the nodes are
 * still produced, so the AST does not depend on the switch. Each
 * `smart_punctuation` node carries the author's source run in `value`, and
 * with the switch off that is what is emitted.
 *
 * Before this existed the option was ACCEPTED AND IGNORED, which §8 names as
 * the one forbidden state - a host wires it up, gets no error, and ships a
 * page that looks configured and is not.
 */
describe('smartTypography switch', () => {
  const src = 'He said "hi" ... a--b and a->b and (c) +-\n'

  it('substitutes by default', () => {
    expect(carveToHtml(src)).toBe('<p>He said “hi” … a–b and a→b and © ±</p>')
  })

  it('emits the author source run when off', () => {
    expect(carveToHtml(src, { smartTypography: false })).toBe(
      '<p>He said "hi" ... a--b and a-&gt;b and (c) +-</p>',
    )
  })

  it('treats true as the default', () => {
    expect(carveToHtml(src, { smartTypography: true })).toBe(carveToHtml(src))
  })

  it('does not change escaping', () => {
    // Escaping is a separate concern with its own rationale (carve#357), so
    // the switch must not disturb it in either position.
    const s = 'a & b < c\n'
    expect(carveToHtml(s, { smartTypography: false })).toBe(carveToHtml(s))
  })

  it('leaves a code span alone in both settings', () => {
    // §8 already scopes the substitution outside code; the switch changes
    // nothing there.
    const s = 'text `a--b` text\n'
    expect(carveToHtml(s, { smartTypography: false })).toContain('<code>a--b</code>')
    expect(carveToHtml(s)).toContain('<code>a--b</code>')
  })
})
