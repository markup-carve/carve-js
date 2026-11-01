import { describe, expect, it } from 'vitest'
import { carveToHtml } from '../src/index.js'

describe('braced comments do not decide quote direction (carve#4719)', () => {
  it('closes a double quote before a trailing comment', () => {
    expect(carveToHtml('"a-"{%%}\n')).toBe('<p>“a-”</p>')
  })

  it('closes a single quote before a trailing comment', () => {
    expect(carveToHtml("'a-'{%%}\n")).toBe('<p>‘a-’</p>')
  })

  it('reads the visible character after a braced comment', () => {
    expect(carveToHtml('"a-"{% x %}x\n')).toBe('<p>“a-“x</p>')
  })

  it('skips adjacent comments before the visible flank', () => {
    expect(carveToHtml('"a-"{%%}{% x %} end\n')).toBe('<p>“a-” end</p>')
  })
})
