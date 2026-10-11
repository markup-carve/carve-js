import { describe, expect, it } from 'vitest'
import { carveToAstJson, carveToCarve, carveToHtml } from '../src/index.js'

const tree = (source: string) =>
  JSON.stringify(carveToAstJson(source), (key, value) => key === 'pos' || key === 'srcByteLength' ? undefined : value)

describe('an emphasis ending in an escaped space', () => {
  for (const delimiter of ['*', '/', '_', '~', '=']) {
    it.each([
      `{${delimiter}\\ ${delimiter}}\n`,
      `{${delimiter}x\\ ${delimiter}}\n`,
      `a {${delimiter}b\\ ${delimiter}} c\n`,
      `\ue004 {${delimiter}x\\ ${delimiter}}\n`,
    ])(`keeps ${delimiter} braces in %s`, source => {
      const written = carveToCarve(source)
      expect(written).toBe(source)
      expect(tree(written)).toBe(tree(source))
      expect(carveToHtml(written)).toBe(carveToHtml(source))
      expect(carveToCarve(written)).toBe(written)
    })

    it(`keeps the bare ${delimiter} spelling when text follows the escape`, () => {
      expect(carveToCarve(`{${delimiter}\\ x${delimiter}}\n`)).toBe(`${delimiter}\\ x${delimiter}\n`)
      expect(carveToCarve(`{${delimiter}\\!${delimiter}}\n`)).toBe(`${delimiter}\\!${delimiter}\n`)
    })

    it(`keeps the bare ${delimiter} spelling for an authored private-use character`, () => {
      expect(carveToCarve(`{${delimiter}x\ue004${delimiter}}\n`)).toBe(`${delimiter}x\ue004${delimiter}\n`)
    })
  }

  it.each(['+', '-'])('keeps the editorial %s spelling', delimiter => {
    const source = `{${delimiter}\\ ${delimiter}}\n`
    expect(carveToCarve(source)).toBe(source)
  })
})
