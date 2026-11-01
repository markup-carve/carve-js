import { describe, expect, it } from 'vitest'
import { carveToHtml } from '../src/index.js'

describe('invisible lines preserve description ownership (carve#4716)', () => {
  it.each(['%% c', '%%%tail', '[r]: /u', '*[A]: b'])(
    'keeps a description at the term column after %s', invisible => {
      expect(carveToHtml(`:: t\n${invisible}\n : d\n`)).toBe(
        '<dl>\n  <dt>t</dt>\n  <dd>d</dd>\n</dl>',
      )
    },
  )

  it.each(['%% c', '%%%tail', '[r]: /u', '*[A]: b'])(
    'keeps a quote continuation in the description after %s', invisible => {
      expect(carveToHtml(`:: t\n${invisible}\n:  > a\n   > b\n`)).toBe(
        '<dl>\n  <dt>t</dt>\n  <dd>\n    <blockquote><p>a\nb</p></blockquote>\n  </dd>\n</dl>',
      )
    },
  )
})

describe('outer item tightness after a nested item ends (carve#4734)', () => {
  it('wraps the outer paragraphs separated by a blank', () => {
    expect(carveToHtml('- outer\n  - head\n    :::\n  p\n\n    q\n')).toBe(
      '<ul>\n  <li><p>outer</p>\n    <ul>\n      <li>head\n        <div>\n\n        </div>\n      </li>\n    </ul>\n    <p>p</p>\n    <p>q</p>\n  </li>\n</ul>',
    )
  })
})
