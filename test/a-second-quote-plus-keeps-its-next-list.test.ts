import { describe, expect, it } from 'vitest'
import { carveToHtml } from '../src/index.js'

describe('a quote reclaims its next marker after an attached block', () => {
  it.each(['* e', '. e', '1. e'])('keeps a different list after %s', first => {
    expect(carveToHtml(`>\n+\n${first}\n+\n- y\n`)).toBe(
      `<blockquote>\n  ${first.startsWith('*') ? '<ul>' : '<ol>'}\n    <li>e</li>\n  ${first.startsWith('*') ? '</ul>' : '</ol>'}\n  <ul>\n    <li>y</li>\n  </ul>\n</blockquote>`,
    )
  })
})
