import { describe, it, expect } from 'vitest'
import { carveToHtml } from '../src/index.js'

/**
 * Editorial substitution and editorial comment have no attribute slot: the
 * grammar gives one to addition and deletion only (CARVE-P3-017), so a block
 * after either of the other two is literal text (markup-carve/carve#2138).
 *
 * It was attaching to the node, whose renderer emits no attributes, so the
 * block vanished from the output.
 */
describe('an attribute block after editorial substitution or comment is literal', () => {
  const html = (src: string) => carveToHtml(src).trim()

  it('keeps the block after a substitution', () => {
    expect(html('{~a~>b~}{.k} c')).toBe('<p><del>a</del><ins>b</ins>{.k} c</p>')
  })

  it('keeps the block after a comment', () => {
    expect(html('{#note#}{.k} c')).toBe('<p><span class="critic-comment">note</span>{.k} c</p>')
  })

  it('keeps every block of a run after a substitution', () => {
    expect(html('{~a~>b~}{.k}{.j} c')).toBe('<p><del>a</del><ins>b</ins>{.k}{.j} c</p>')
  })

  it('still attaches a block to an addition and a deletion', () => {
    // The pair the slot exists for. It is what says the node type, not the
    // editorial family, decides the answer.
    expect(html('{+a+}{.k}')).toBe('<p><ins class="k">a</ins></p>')
    expect(html('{-a-}{.k}')).toBe('<p><del class="k">a</del></p>')
  })
})
