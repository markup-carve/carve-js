import { describe, expect, it } from 'vitest'
import { lintAccessibility } from '../src/index.js'

describe('accessibility lint', () => {
  it('reports empty image alternative text with a source range', () => {
    const findings = lintAccessibility('![](/image.png)\n')
    expect(findings).toHaveLength(1)
    expect(findings[0]).toMatchObject({ rule: 'a11y/image-alt', severity: 'error', startOffset: 0 })
  })

  it('reports heading jumps but accepts descents', () => {
    const findings = lintAccessibility('# One\n\n### Three\n\n## Two\n')
    expect(findings).toHaveLength(1)
    expect(findings[0]).toMatchObject({ rule: 'a11y/heading-jump', severity: 'warning' })
  })

  it('accepts described images and ordered headings', () => {
    expect(lintAccessibility('# One\n\n## Two\n\n![Map](/map.png)\n')).toEqual([])
  })
})
