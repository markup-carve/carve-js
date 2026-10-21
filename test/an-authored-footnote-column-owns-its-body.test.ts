import { describe, expect, it } from 'vitest'
import { carveToHtml } from '../src/index.js'

describe('an authored footnote column owns its body', () => {
  it('takes a marker that reaches the body column', () => {
    expect(carveToHtml('. d\n   [^n]: e\n     - a\n')).toBe(
      '<ol>\n  <li>d</li>\n</ol>',
    )
  })

  it('leaves a marker one column below the body in the item', () => {
    expect(carveToHtml('. d\n   [^n]: e\n    - a\n')).toBe(
      '<ol>\n  <li>d\n    <ul>\n      <li>a</li>\n    </ul>\n  </li>\n</ol>',
    )
  })

  it('opens a block after a blank below the body column', () => {
    expect(carveToHtml('- a\n    [^n]: e\n\n     ||\n')).toBe(
      '<ul>\n  <li>a\n    <table>\n      <tbody>\n        <tr><td></td></tr>\n      </tbody>\n    </table>\n  </li>\n</ul>',
    )
  })

  it('keeps a non-opener in the item paragraph', () => {
    expect(carveToHtml('- a\n    [^n]: e\n\n     || x\n')).toBe(
      '<ul>\n  <li><p>a</p>\n    <p>|| x</p>\n  </li>\n</ul>',
    )
  })

  it('returns an attached quote to the outer item', () => {
    expect(carveToHtml('- a\n  1. ordered\n    [^n]: note\n  +\n  > quote\n')).toBe(
      '<ul>\n  <li>a\n    <ol>\n      <li>ordered</li>\n    </ol>\n    <blockquote><p>quote</p></blockquote>\n  </li>\n</ul>',
    )
  })

  it('keeps every line of an attached fenced block', () => {
    expect(carveToHtml('- a\n  1. o\n    [^n]: note\n  +\n  ```\n  code\n  ```\n  tail\n')).toBe(
      '<ul>\n  <li>a\n    <ol>\n      <li>o</li>\n    </ol>\n    <pre><code>code\n</code></pre>\n    tail\n  </li>\n</ul>',
    )
  })
})
