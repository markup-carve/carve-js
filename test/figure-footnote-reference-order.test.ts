import { describe, expect, it } from 'vitest'
import { parse, renderHtml } from '../src/index.js'

describe('figure footnote reference order', () => {
  it('numbers quote body references before attribution references', () => {
    const html = renderHtml(parse('> [^n]\n^ [^n]\n\n[^n]: x\n'))
    expect(html).toContain('<blockquote><p><a id="fnref1"')
    expect(html).toContain('<figcaption><a id="fnref1-2"')
  })
})
