import { describe, it, expect } from 'vitest'
import { carveToHtml, index } from '../src/index.js'

describe(':index[term] marker does not feed the heading slug', () => {
  it('keeps the heading id as the title only', () => {
    const out = carveToHtml('# Title :index[term]\n\n::: index\n:::\n', { extensions: [index()] })
    expect(out).toContain('id="Title"')
    expect(out).not.toContain('id="Title-term"')
  })
})
