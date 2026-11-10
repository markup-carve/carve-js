import { describe, expect, it } from 'vitest'
import { carveToHtml } from '../src/index.js'

describe('block comment runs with brace-shaped continuations', () => {
  it('removes a completed comment after a paragraph', () => {
    expect(carveToHtml('p\n{% a\n {lang=de}\n z %}\n')).toBe('<p>p\n</p>')
  })

  it('removes a comment-only paragraph', () => {
    expect(carveToHtml('{% a\n {lang=de}\n z %}\n')).toBe('')
  })
})
