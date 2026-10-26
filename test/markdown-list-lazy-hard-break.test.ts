import { describe, expect, it } from 'vitest'
import { carveToHtml, markdownToCarve } from '../src/index.js'

describe('Markdown hard breaks before lazy list continuations', () => {
  it('preserves the break on an unordered marker line', () => {
    const carve = markdownToCarve('- a  \nb')
    expect(carve).toBe('- a\\\n  b')
    expect(carveToHtml(carve)).toContain('a<br>\nb')
  })

  it.each(['1. a  \nb', '- - a  \nb', '+ word   \nnext'])('preserves a split list paragraph: %s', source => {
    expect(carveToHtml(markdownToCarve(source))).toContain('<br>')
  })

  it('leaves a soft break soft', () => {
    expect(carveToHtml(markdownToCarve('- a\nb'))).not.toContain('<br>')
  })
})
