import { describe, expect, it } from 'vitest'
import { carveToCarve, carveToHtml } from '../src/index.js'

describe('canonical writer omits consumed floating attributes', () => {
  it('drops an unattached attribute before a transparent abbreviation definition', () => {
    const source = '- A\n{x}\n*[A]: }\n'
    const expected = '- A\n\n*[A]: }\n'
    expect(carveToCarve(source)).toBe(expected)
    expect(carveToCarve(expected)).toBe(expected)
    expect(carveToHtml(expected)).toBe(carveToHtml(source))
  })

  it('does not restore an attribute lost at document end', () => {
    const source = '- A\n{x}\n*[A]: }\n{unused}\n'
    const expected = '- A\n\n*[A]: }\n'
    expect(carveToCarve(source)).toBe(expected)
  })

  it('drops the attribute while keeping transparent definitions in authored order', () => {
    const source = '- A\n{x}\n[r]: /x\n*[A]: }\n'
    const expected = '- A\n\n[r]: /x\n*[A]: }\n'
    expect(carveToCarve(source)).toBe(expected)
    expect(carveToCarve(expected)).toBe(expected)
    expect(carveToHtml(expected)).toBe(carveToHtml(source))
  })
})
