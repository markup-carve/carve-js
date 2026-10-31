import { describe, expect, it } from 'vitest'
import { carveToHtml } from '../src/index.js'

describe('a comment fence ends when its owner is missed', () => {
  it('leaves a quote on the first unmarked line before a later quoted delimiter', () => {
    expect(carveToHtml('> %%%\n> x\ny\n> %%%\n')).toBe(
      '<blockquote><p>x</p></blockquote>\n<p>y</p>\n<blockquote>\n\n</blockquote>',
    )
  })

  it('leaves a description on the first line below its content column', () => {
    expect(carveToHtml(':: t\n: %%%\n  x\ny\n  %%%\n')).toBe(
      '<dl>\n  <dt>t</dt>\n  <dd>x</dd>\n</dl>\n<p>y</p>',
    )
  })

  it('keeps a reached delimiter and a note body in their owners', () => {
    expect(carveToHtml('> %%%\n> x\n> %%%\n')).toBe('<blockquote>\n\n</blockquote>')
    expect(carveToHtml(':: t\n: %%%\n  x\n  %%%\n')).toBe('<dl>\n  <dt>t</dt>\n  <dd></dd>\n</dl>')
    expect(carveToHtml('[^n]: %%%\n  x\ny\n  %%%\n\nsee[^n]\n')).toContain('<p>y</p>')
  })
})
