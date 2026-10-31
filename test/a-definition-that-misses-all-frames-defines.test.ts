import { describe, expect, it } from 'vitest'
import { carveToHtml } from '../src/index.js'

const use = '\n\nA\n'

describe('a definition that misses every frame', () => {
  it('defines below an item at columns zero and one', () => {
    for (const pad of ['', ' ']) {
      expect(carveToHtml(`- n\n${pad}*[A]: b${use}`)).toBe(
        '<ul>\n  <li>n</li>\n</ul>\n<p><abbr title="b">A</abbr></p>',
      )
    }
  })

  it('stays text at the item content column', () => {
    expect(carveToHtml('- n\n  *[A]: b' + use)).toBe(
      '<ul>\n  <li>n\n*[A]: b</li>\n</ul>\n<p>A</p>',
    )
  })

  it('defines below a description body and a note body', () => {
    expect(carveToHtml(':: t\n: n\n*[A]: b' + use)).toContain('<p><abbr title="b">A</abbr></p>')
    expect(carveToHtml('[^f]: n\n*[A]: b' + use)).toContain('<p><abbr title="b">A</abbr></p>')
  })

  it('keeps an abbreviation in a list attached inside a quote as text', () => {
    expect(carveToHtml('> x\n+\n- A\n*[A]: b\n')).toContain('<li>A\n*[A]: b</li>')
  })
})
