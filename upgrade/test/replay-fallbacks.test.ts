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

  it('combines a braced strong-emphasis span with a literal legacy table cell', () => {
    const input = '/*a*/b c*/\n|=^ Top |=v Bottom |={<^} Paired |=v> Reverse |=~> Middle |\n| a | b | c | d | e |\n'
    const result = upgrade(input)
    expect(result.check).toBe('pass')
    expect(result.output).toContain('|\\=~> Middle |')
    expect(render(result.output)).toBe(carveToHtml(input))
  })

  it('lifts a duplicate definition from empty quoted list items', () => {
    const input = '> - [d]: u\n> - [d]: u\n[go][d]\n'
    const result = upgrade(input)
    expect(result.check).toBe('pass')
    expect(result.output).toBe('[d]: u\n\n> - {% %}\n> - {% %}\n\n[go][d]\n')
    expect(render(result.output)).toBe(carveToHtml(input))
  })
})
