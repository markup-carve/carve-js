import { describe, expect, it } from 'vitest'
import { carveToAnsi } from '../src/index.js'

const ESC = String.fromCharCode(27)
const RESET = `${ESC}[0m`

/**
 * The combined bold-italic form is ONE construct, so it gets one style run and one
 * reset. Rendering it as nested strong-around-emphasis emitted a reset per level -
 * `ESC[1m ESC[3m x ESC[0m ESC[0m` - and the second is redundant, since a reset
 * clears every attribute.
 *
 * carve-rs carries bold-italic as a single kind and always emitted one, which is
 * why this showed up as a cross-engine divergence rather than as visibly wrong
 * output (carve#352, corpus 01-emphasis and both 128-bold-italic cases).
 */
describe('ANSI bold italic emits one reset', () => {
  it('emits a single reset for the combined form', () => {
    const out = carveToAnsi('/*x*/\n')
    expect(out).toBe(`${ESC}[1m${ESC}[3mx${RESET}\n`)
  })

  it('emits one reset mid-word too', () => {
    expect(carveToAnsi('a/*y*/b\n')).toBe(`a${ESC}[1m${ESC}[3my${RESET}b\n`)
  })

  it('still nests when the author wrote the nested spelling', () => {
    // `*/x/*` is strong around emphasis with no combined marker, so it keeps the
    // per-level styling it has always had.
    const out = carveToAnsi('*/x/*\n')
    expect(out).toContain(`${ESC}[1m`)
    expect(out).toContain(`${ESC}[3m`)
  })

  it('leaves an ordinary strong alone', () => {
    expect(carveToAnsi('*x*\n')).toBe(`${ESC}[1mx${RESET}\n`)
  })

  it('leaves an ordinary emphasis alone', () => {
    expect(carveToAnsi('/x/\n')).toBe(`${ESC}[3mx${RESET}\n`)
  })
})
