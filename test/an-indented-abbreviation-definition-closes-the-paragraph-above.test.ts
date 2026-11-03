import { describe, expect, it } from 'vitest'
import { carveToHtml } from '../src/index.js'

// carve-js#4248: an indented abbreviation definition is an invisible line like a
// link definition, so the paragraph above it is over and a column-0 line leaves.
describe('an indented abbreviation definition closes the paragraph above it', () => {
  it('keeps the following line in the document', () => {
    expect(carveToHtml('[^c]: - para\n        *[A]: b\nx\n')).toBe("")
  })

  it('keeps the following line out of a referenced note', () => {
    const html = carveToHtml('[^c]: - para\n        *[A]: b\nx\n\n[^c] A\n')
    expect(html).toContain('<p>x</p>')
    expect(html).toContain('<abbr title="b">A</abbr>')
    expect(html).toContain('<li>para</li>')
  })

  it('reads the same as a link definition in the same place', () => {
    const link = carveToHtml('- - para\n    [r]: /u\nx\n')
    const abbr = carveToHtml('- - para\n    *[A]: b\nx\n')
    expect(abbr).toBe(link)
  })
})
