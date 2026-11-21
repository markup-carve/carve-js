import { describe, expect, it } from 'vitest'
import { carveToHtml } from '../../build/engine-0.1/index.js'
import { render } from '../../src/index.ts'
import { upgrade } from '../src/index.ts'

describe('replay fallback families', () => {
  it('keeps a quote-shaped paragraph below an attribute line', () => {
    const input = '{#_id ._c _k=1 _="on click"}\n>> \npara\n'
    const result = upgrade(input)
    expect(result.check).toBe('pass')
    expect(result.output).toBe(input)
    expect(render(result.output)).toBe(carveToHtml(input))
  })

  it('keeps an indented fence run in the body and attaches the following caption', () => {
    const input = '\n```python\ndef greet():\n    return 1\n  ```\n```\n\n^ Listing: a greeting\n'
    const result = upgrade(input)
    expect(result.check).toBe('pass')
    expect(result.output).toBe('\n````python\ndef greet():\n    return 1\n  ```\n````\n^ Listing: a greeting\n')
    expect(render(result.output)).toBe(carveToHtml(input))
  })

  it('preserves adjacent reversed and ordinary strong-emphasis spans', () => {
    const input = 'b */{/*/*{t="*/"}\nb *///*{t="*/"}\n'
    const result = upgrade(input)
    expect(result.check).toBe('pass')
    expect(result.output).toContain('{*{/\\{/}*}')
    expect(render(result.output)).toBe(carveToHtml(input))
  })

  it('preserves an attributed strong pair across a line beside a bold-italic pair', () => {
    const input = '/*a // b*/\n //*a*{c_}*/\n //*a*{c_}*/\n'
    const result = upgrade(input)
    expect(result.check).toBe('pass')
    expect(result.output).toContain('{*/\n //*a*}{c_}')
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

  it('keeps a code opener out of a link and a literal definition out of the registry', () => {
    const input = '[okref]: https://e.com/path\n\n[t](u``` v) and [ok](u-v)\n\n'
      + '[r]: https://e.com /path\n\t[text][r] and [text][okref]\n'
    const result = upgrade(input)
    expect(result.check).toBe('pass')
    expect(result.output).toContain('\\[t](u```')
    expect(result.output).toContain('\\[r]: https://e.com /path')
    expect(render(result.output)).toBe(carveToHtml(input))
  })

  it('keeps a code span across a continuation row on one pipe-table row', () => {
    const input = '\n> | x | a `b |\n> + y | c` ||\n'
    const result = upgrade(input)
    expect(result.check).toBe('pass')
    expect(result.output).toBe('\n> | x y | a `b c` |\n')
    expect(render(result.output)).toBe(carveToHtml(input))
  })

  it('combines abbreviation separator cleanup with definition and attribute moves', () => {
    const input = ' *[HTML]:  Long Form\n{#_id ._c _k=1 _="on click"}\n\nThe [HTML]{.x} key.\n'
    const result = upgrade(input)
    expect(result.check).toBe('pass')
    expect(result.records.map((record) => record.entry)).toContain('U-376')
    expect(result.output).toContain('*[HTML]: Long Form')
    expect(render(result.output)).toBe(carveToHtml(input))
  })

  it('keeps an empty quote after its attribute-only line is removed', () => {
    const input = '[x]{.a!b}\n- > - para\n^ c[d]: uap\n  >   {#x}\n'
    const result = upgrade(input)
    expect(result.check).toBe('pass')
    expect(result.output).toBe('[x]{.a!b}\n- > - para\n^ c[d]: uap\n\n> \n')
    expect(render(result.output)).toBe(carveToHtml(input))
  })

  it('keeps an indented list as a sibling after an ordered list', () => {
    const input = '1. ordered\n 1. ordered\n *  > > quote\nQ  \n- item\n'
    const result = upgrade(input)
    expect(result.check).toBe('pass')
    expect(result.output).toBe('1. ordered\n1. ordered\n\n*  > > quote\nQ  \n- item\n')
    expect(render(result.output)).toBe(carveToHtml(input))
  })
})
