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

  it('separates two indented sibling headings', () => {
    const input = '-{#k} text\n # h\n # h\n'
    const result = upgrade(input)
    expect(result.check).toBe('pass')
    expect(result.output).toBe('-{#k} text\n\n# h\n\n # h\n')
    expect(render(result.output)).toBe(carveToHtml(input))
  })

  it('keeps an empty attribute-only item after a description', () => {
    const input = '  > y\n:: term\n:  definition\n-     {.k}\n- tail\n'
    const result = upgrade(input)
    expect(result.check).toBe('pass')
    expect(result.output).toBe('  > y\n\n:: term\n:  definition\n\n-     {% %}\n- tail\n')
    expect(render(result.output)).toBe(carveToHtml(input))
  })

  it('keeps an empty div after an indented colon fence line', () => {
    const input = '~s~\n\n- ::: note\n  1. para text\n :::\n'
    const result = upgrade(input)
    expect(result.check).toBe('pass')
    expect(result.output).toBe('{~s~}\n\n- ::: note\n  1. para text\n :::\n\n:::\n:::\n')
    expect(render(result.output)).toBe(carveToHtml(input))
  })

  it('keeps an empty div inside an admonition with a long closing run', () => {
    const input = '::: note "Title"\t[First]\n x\n:::::\n'
    const result = upgrade(input)
    expect(result.check).toBe('pass')
    expect(result.output).toBe(':::: note\n x\n:::\n:::\n::::\n')
    expect(render(result.output)).toBe(carveToHtml(input))
  })

  it('marks the first cell of a continued header row before removing its separator', () => {
    const input = '\n| a | b |\n + cont |\n| - | - |\n'
    const result = upgrade(input)
    expect(result.check).toBe('pass')
    expect(result.output).toBe('\n|= a |= b |\n + cont |\n')
    expect(render(result.output)).toBe(carveToHtml(input))
  })

  it('separates a description from a quoted term', () => {
    const input = '> :: t\n:: t\n: 1. para\n> : d\n>   [^f]: n\ntail\n'
    const result = upgrade(input)
    expect(result.check).toBe('pass')
    expect(result.output).toBe('> :: t\n\n:: t\n: 1. para\n\n> : d\n\n[^f]: n\ntail\n')
    expect(render(result.output)).toBe(carveToHtml(input))
  })

  it('moves nested footnote definitions to document scope after an item', () => {
    const input = '- item\n  [^c]: [^d]: para\n\n::::\n          more\n\n   ~~~\n  See[^c][^d]\n'
    const result = upgrade(input)
    expect(result.check).toBe('pass')
    expect(result.output).toContain('\n\n[^c]: [^d]: para\n')
    expect(render(result.output)).toBe(carveToHtml(input))
  })

  it('keeps adjacent old smart punctuation glyphs in a quoted item', () => {
    const input = '{.x}\n\n> - +---\n> q\n'
    const result = upgrade(input)
    expect(result.check).toBe('pass')
    expect(result.output).toBe('{.x}\n> - ±–\n> q\n')
    expect(render(result.output)).toBe(carveToHtml(input))
  })

  it('keeps a tabbed paragraph inside its old footnote body', () => {
    const input = ' [^a]: note\n\n\tmore\n::: note\n\nsee[^a]\n'
    const result = upgrade(input)
    expect(result.check).toBe('pass')
    expect(result.output).toBe('[^a]: note\n\n more\n::: note\n\nsee[^a]\n')
    expect(render(result.output)).toBe(carveToHtml(input))
  })

  it('places a quote after a description at the old footnote column', () => {
    const input = ' [^n]: intro\n\n   :: term\n   :  definition\n    > quote\n\nsee[^n]\n'
    const result = upgrade(input)
    expect(result.check).toBe('pass')
    expect(result.output).toBe('[^n]: intro\n\n  :: term\n  :  definition\n\n  > quote\n\nsee[^n]\n')
    expect(render(result.output)).toBe(carveToHtml(input))
  })

  it('keeps a document list outside the footnote above it', () => {
    const input = '[^a]: note\n \n - one\n    - deep\n\n  end.\n\nsee[^a]\n'
    const result = upgrade(input)
    expect(result.check).toBe('pass')
    expect(result.output).toBe('[^a]: note\n \n- one\n    - deep\n\nend.\n\nsee[^a]\n')
    expect(render(result.output)).toBe(carveToHtml(input))
  })

  it('does not duplicate an inline escape when two rules reach the same star', () => {
    const input = '\\!\\"\\#\\$\\%\\&\\\'\\(\\)\\*\\+\\,\\-\\.\\/\\:\\;\\<\\=\\>\\?\\@\\[\\\\\\]\\^\\_\\`\\{\\|\\}\\~ done\n*a {*b**} c*\n{#i}\n'
    const result = upgrade(input)
    expect(result.check).toBe('pass')
    expect(result.output).toBe(input.replace('\n{#i}\n', '\n'))
    expect(render(result.output)).toBe(carveToHtml(input))
  })

  it('keeps a braced strike beside its preceding pipe', () => {
    const input = '{|= a |= b |~{+b~>c+}~>a~}\n@user\n'
    const result = upgrade(input)
    expect(result.check).toBe('pass')
    expect(result.output).toBe('{|= a |= b |{~{+b~>c+}~}>a~}\n@user\n')
    expect(render(result.output)).toBe(carveToHtml(input))
  })

  it('removes an empty quoted line without splitting the footnote body', () => {
    const input = '1. a\n   [^f]: note\n    more\n>> \ntail\n'
    const result = upgrade(input)
    expect(result.check).toBe('pass')
    expect(result.output).toBe('1. a\n\n[^f]: note\n more\ntail\n')
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
