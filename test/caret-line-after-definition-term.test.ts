import { describe, expect, it } from 'vitest'
import { carveToHtml } from '../src/index.js'

describe('caret line after a definition term', () => {
  it('starts a paragraph at the content column', () => {
    expect(carveToHtml(':: term\n^ caption\n')).toBe('<dl>\n  <dt>term</dt>\n</dl>\n<p>^ caption</p>')
  })

  it('keeps an ordinary line in the term', () => {
    expect(carveToHtml(':: term\nplain\n')).toBe('<dl>\n  <dt>term\nplain</dt>\n</dl>')
  })
})
