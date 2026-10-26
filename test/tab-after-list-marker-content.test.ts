import { describe, expect, it } from 'vitest'
import { carveToHtml } from '../src/index.js'

describe('tab after a list marker', () => {
  it.each([
    ['- \t> a', '<ul>\n  <li>&gt; a</li>\n</ul>'],
    ['* \t> a', '<ul>\n  <li>&gt; a</li>\n</ul>'],
    ['1. \t> a', '<ol>\n  <li>&gt; a</li>\n</ol>'],
    ['- \t# a', '<ul>\n  <li># a</li>\n</ul>'],
  ])('keeps the post-marker tab in %s from exposing a block opener', (source, html) => {
    expect(carveToHtml(source)).toBe(html)
  })
})
