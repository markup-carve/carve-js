import { describe, expect, it } from 'vitest'
import { carveToHtml } from '../../build/engine-0.1/index.js'
import { render } from '../../src/index.ts'
import { upgrade } from '../src/index.ts'

describe('replay fallback families', () => {
  it('preserves adjacent reversed and ordinary strong-emphasis spans', () => {
    const input = 'b */{/*/*{t="*/"}\nb *///*{t="*/"}\n'
    const result = upgrade(input)
    expect(result.check).toBe('pass')
    expect(result.output).toContain('{*{/\\{/}*}')
    expect(render(result.output)).toBe(carveToHtml(input))
  })
})
