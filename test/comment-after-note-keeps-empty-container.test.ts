import { describe, expect, it } from 'vitest'
import { carveToHtml } from '../src/index.js'

describe('a comment after an unreferenced note', () => {
  it('leaves the following container at document level', () => {
    expect(carveToHtml('[^n]: note\n%%\n::::\n')).toBe('<div>\n\n</div>')
  })

  it('leaves the container without a comment', () => {
    expect(carveToHtml('[^n]: note\n::::\n')).toBe('<div>\n\n</div>')
  })
})
