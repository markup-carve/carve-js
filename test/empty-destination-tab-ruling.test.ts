import { describe, expect, it } from 'vitest'
import { carveToCarve, carveToHtml } from '../src/index.js'

describe('empty destination padding', () => {
  it('accepts spaces for links and images', () => {
    expect(carveToHtml('[t](  )')).toBe('<p><a href="">t</a></p>')
    expect(carveToHtml('![a](  )')).toBe('<img src="" alt="a">')
  })

  it('keeps a tab in the tail as literal text', () => {
    for (const source of ['[t](\t)', '![a](\t)']) {
      expect(carveToHtml(source)).toBe(`<p>${source}</p>`)
      expect(carveToCarve(source).trim()).toBe(source)
    }
  })
})
