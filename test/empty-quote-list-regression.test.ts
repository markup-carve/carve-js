import { describe, expect, it } from 'vitest'
import { carveToHtml } from '../src/index.js'

describe('empty quote in a list', () => {
  it('ends the item before a flush-left follower', () => {
    expect(carveToHtml('- outer\n    > \n[r][]\n')).toBe(
      '<ul>\n  <li>outer\n    <blockquote>\n\n    </blockquote>\n  </li>\n</ul>\n<p>[r][]</p>',
    )
  })

  it('lets a quote paragraph take a flush-left follower', () => {
    expect(carveToHtml('- outer\n    > q\n[r][]\n')).toBe(
      '<ul>\n  <li>outer\n    <blockquote><p>q\n[r][]</p></blockquote>\n  </li>\n</ul>',
    )
  })
})
