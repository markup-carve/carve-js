import { describe, expect, it } from 'vitest'
import { carveToMarkdown } from '../src/index.js'

/**
 * A change of bullet marker is what SEPARATES two adjacent lists in CommonMark,
 * so normalizing every bullet to `-` merges lists the source kept apart. That
 * is a meaning change, and exactly what a renderer must not do (carve#352).
 */
describe('the Markdown renderer keeps the authored bullet', () => {
  it('keeps two adjacent lists apart', () => {
    const src = '- a\n- b\n\n* c\n* d\n'
    const out = carveToMarkdown(src)
    expect(out).toContain('- a')
    expect(out).toContain('* c')
  })

  it('keeps the bullet on a task list', () => {
    expect(carveToMarkdown('* [x] done\n')).toContain('* [x] done')
  })

  it('leaves a hyphen list as a hyphen list', () => {
    expect(carveToMarkdown('- a\n')).toContain('- a')
  })
})
