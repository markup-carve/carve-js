import { describe, expect, it } from 'vitest'
import { carveToHtml } from '../src/index.js'

describe('definition description blocks after a nested list', () => {
  it('opens a quote at the description base after a blank', () => {
    const html = carveToHtml(':: term\n: - a\n\n   > c')
    expect(html).toContain('<blockquote><p>c</p></blockquote>')
    expect(html).not.toContain('<p>&gt; c</p>')
  })

  it.each([['# h', '<h1 id="h">h</h1>'], ['|x|', '<td>x</td>']])('opens %s as a sibling block', (block, expected) => {
    const html = carveToHtml(`:: term\n: - a\n\n   ${block}`)
    expect(html).toContain(expected)
  })
})
