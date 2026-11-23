import { describe, expect, it } from 'vitest'
import { carveToHtml } from '../../build/engine-0.1/index.js'
import { render } from '../../src/index.ts'
import { compareHtml } from '../src/compare.ts'
import { upgrade } from '../src/index.ts'

describe('U-113: a bracket child of an unresolved reference', () => {
  it.each([
    ['`\n\n[[]{}][]\n', '`\n\n\\[\\[]{}][]\n'],
    ['`\n\n[a [x](u) b][r]\n', '`\n\n\\[a \\[x](u) b][r]\n'],
  ])('escapes the reference bracket too, so the outer bracket pairs with nothing: %j', (source, output) => {
    const result = upgrade(source)
    expect(result.output).toBe(output)
    // U-439 reports the empty code run of the first line.
    expect(result.check).toBe('explained')
    expect(result.records.some((record) => record.entry === 'U-430')).toBe(false)
  })
})

describe('U-273: the explicit inline spelling keeps a 0.1 braced span', () => {
  it.each([
    ['/**/\n/*{*/*}*/\n', '{*{/\\*\\/\n\\/\\*{*\\/*}/}*}\n'],
    ['/**/*{*/*}*/\n', '{*{/\\*\\/\\*{*\\/*}/}*}\n'],
  ])('braces the outer spans and escapes the text inside the braced one: %j', (source, output) => {
    const result = upgrade(source)
    expect(result.output).toBe(output)
    expect(result.check).toBe('pass')
    expect(compareHtml(carveToHtml(source), render(result.output)).equal).toBe(true)
  })
})
