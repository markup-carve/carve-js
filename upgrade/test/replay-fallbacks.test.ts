import { describe, expect, it } from 'vitest'
import { carveToHtml } from '../../build/engine-0.1/index.js'
import { render } from '../../src/index.ts'
import { upgrade } from '../src/index.ts'

describe('replay fallback families', () => {
  it('keeps a nested quote list after a quoted plus line', () => {
    const input = '- - +\n> +\n> - s\n  b\n'
    const result = upgrade(input)
    expect(result.check).toBe('pass')
    expect(result.output).toBe('- - {%%}\n\n> > - s\n  b\n')
    expect(render(result.output)).toBe(carveToHtml(input))
  })

  it('keeps an old admonition around a longer div with an unclosed fence', () => {
    const input = '::: note\n- para\n  [^f]: n\n::::\n```\ncode\n::::\n:::\nafter *b*\n'
    const result = upgrade(input)
    expect(result.check).toBe('pass')
    expect(result.output).toBe('[^f]: n\n\n::::: note\n- para\n::::\n```\ncode\n::::\n:::\nafter *b*\n')
    expect(render(result.output)).toBe(carveToHtml(input))
  })

  it('keeps repeated indented notes together before a following fence', () => {
    const input = 'x[^1]\n  \n  [^1]: > q\n  [^1]: > q\n\n        ```js\n       c\n        ```\n'
    const result = upgrade(input)
    expect(result.check).toBe('pass')
    expect(result.output).toBe('x[^1]\n  \n[^1]: > q\n[^1]: > q\n\n        ```js\n       c\n        ```\n')
    expect(render(result.output)).toBe(carveToHtml(input))
  })

  it('keeps a heading below a marker-line attribute without visible attribute text', () => {
    const input = '1.{#k} {#h}\n\n   # h\n'
    const result = upgrade(input)
    expect(result.check).toBe('pass')
    expect(result.output).toBe('1.{#k} {% %}\n\n   # h\n')
    expect(result.records.map((record) => record.entry)).toContain('U-137')
    expect(render(result.output)).toBe(carveToHtml(input))
  })

  it('keeps an old sibling heading outside an empty attribute item', () => {
    for (const gap of ['\n', '\n\n']) {
      const input = `1.{#k} {#h}${gap} # h\n`
      const result = upgrade(input)
      expect(result.check).toBe('pass')
      expect(result.output).toBe('1.{#k} {% %}\n\n# h\n')
      expect(render(result.output)).toBe(carveToHtml(input))
    }
  })

  it('keeps a quoted colon opener and brace as text beside an old inline tag', () => {
    const input = '- > para\ntail\n  > ::: {#x}\n'
    const result = upgrade(input)
    expect(result.check).toBe('pass')
    expect(result.output).toBe('- > para\ntail\n  > \\::: \\{#x}\n')
    expect(result.records.map((record) => record.entry)).toEqual(['U-104', 'U-430'])
    expect(render(result.output)).toBe(carveToHtml(input))
  })

  it('keeps a block opener fused to a comment closer inside the old comment', () => {
    const input = '- a\n  - %%%\n    hidden\n%%%::: note\ntail\n'
    const result = upgrade(input)
    expect(result.check).toBe('pass')
    expect(result.output).toBe('- a\n  - %%%\n    hidden\n%%%\ntail\n')
    expect(render(result.output)).toBe(carveToHtml(input))
  })

  it('keeps repeated fused closers without allocating a rescue for every comment', () => {
    const unit = '- a\n  - %%%\n    hidden\n%%%::: note\ntail\n'
    const input = unit.repeat(100)
    const result = upgrade(input)
    expect(result.check).toBe('pass')
    expect(result.output).toContain('%%%\ntail\n')
    expect(render(result.output)).toBe(carveToHtml(input))
  })

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
    expect(result.output).toBe('> :: t\n:: t\n: 1. para\n\n> : d\n\n[^f]: n\ntail\n')
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
    const input = '\\!\\"\\#\\$\\%\\&\\\'\\(\\)\\*\\+\\,\\-\\.\\/\\:\\;\\<\\=\\>\\?\\@\\[\\\\\\]\\^\\_\\`\\{\\|\\}\\~ done\n'
      + '*a {*b**} c*\n{#i}\n'
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

  it('keeps a lazy caption-shaped line in its quote paragraph', () => {
    const input = '- ![a][r]\n>   x\n> b\n ^ cap\n'
    const result = upgrade(input)
    expect(result.check).toBe('pass')
    expect(result.output).toBe('- ![a][r]\n\n>   x\n> b\n \\^ cap\n')
    expect(render(result.output)).toBe(carveToHtml(input))
  })

  it('widens a nested admonition around an old empty div', () => {
    for (const suffix of ['', ' ']) {
      const input = `:: term\n:  definition\n   ::: note\n   body\n   ::::${suffix}\n_u_\ntail\n`
      const result = upgrade(input)
      expect(result.check).toBe('pass')
      expect(result.output).toContain('   ::::: note\n')
      expect(render(result.output)).toBe(carveToHtml(input))
    }
  })

  it('keeps narrow-space links and their references literal', () => {
    const input = '[okref]: https://e.com/path\n\n_u_\n[t](u v) and [ok](u-v)\n \n[r]: https://e.com /path\n[text][r] and [text][okref]\n'
    const result = upgrade(input)
    expect(result.check).toBe('pass')
    expect(result.output).toContain('\\[t](u v)')
    expect(result.output).toContain('\\[r]: https://e.com /path')
    expect(result.output).toContain('\\[text][r]')
    expect(render(result.output)).toBe(carveToHtml(input))
  })

  it('explains a generated task label on a heading child', () => {
    for (const input of ['- [ ] > q\n- [x] # h\n- [ ] --{.x}-\n', '- [] > q\n- [x] # h\n- [ ] ---\n']) {
      const result = upgrade(input)
      expect(result.check).toBe('explained')
      expect(result.records.some((record) => record.entry === 'U-133')).toBe(true)
      expect(result.records.some((record) => record.entry === 'upgrade-mismatch')).toBe(false)
    }
  })

  it('explains task label spacing beside editorial content', () => {
    for (const input of ['- text\n\n\n- [ ] x {#c#} y\n  [a]: /u {.c}\n^[fn]\n\n[a][]\n',
      '- t\n  %% c\n   ````\n  x\n- [ ] x {#c#} y\n- [x] {# note #}done\n']) {
      const result = upgrade(input)
      expect(result.check).toBe('explained')
      expect(result.records.some((record) => record.entry === 'U-133')).toBe(true)
      expect(result.records.some((record) => record.entry === 'U-159')).toBe(true)
      expect(result.records.some((record) => record.entry === 'upgrade-mismatch')).toBe(false)
    }
  })

  it('keeps a document fence outside the preceding description', () => {
    const input = ':: t\n: a\n ```\n  b\n   ```\n y\n'
    const result = upgrade(input)
    expect(result.check).toBe('pass')
    expect(result.output).toBe(':: t\n: a\n\n````\n b\n  ```\ny\n````\n')
    expect(render(result.output)).toBe(carveToHtml(input))
  })

  it('keeps a converted tilde fence outside the preceding description', () => {
    const input = '- a\n    ```\n\n  ~~~\n:: tail\n:  definition\n   code\n  ~~~\n  more\nafter\n'
    const result = upgrade(input)
    expect(result.check).toBe('pass')
    expect(result.output).toBe('- a\n    ```\n\n  ~~~\n:: tail\n:  definition\n   code\n\n```\nmore\nafter\n')
    expect(render(result.output)).toBe(carveToHtml(input))
  })

  it('keeps a literal include directive from turning sigils into mentions', () => {
    const input = ':: t\n{{ data/p2.csv  @code:csv @lines:00-2 }}\n'
    const result = upgrade(input)
    expect(result.check).toBe('pass')
    expect(result.output).toBe(':: t\n{{ data/p2.csv  \\@code:csv \\@lines:00-2 }}\n')
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

  it.each([
    '{.c}\n>\npara\n',
    '{#_id ._c _k=1 _="on click"}\n> > \npara\n',
    '{.c}\n\n>\t>\npara\n',
    '> {.c}\n',
    '> > {.c}\n',
    '> {.c}\n\n> para\n',
    '> {.c}\n\npara\n',
  ])('keeps the empty quote an attribute line stands above or in: %j', (input) => {
    const result = upgrade(input)
    expect(result.check).toBe('pass')
    expect(render(result.output)).toBe(carveToHtml(input))
  })

  it('widens a fence past the longest indented body run', () => {
    const input = '```\na\n  ```\n  ````\n```\n'
    const result = upgrade(input)
    expect(result.check).toBe('pass')
    expect(result.output).toBe('`````\na\n  ```\n  ````\n`````\n')
    expect(render(result.output)).toBe(carveToHtml(input))
  })

  it.each([
    ['a code span', 'see `[t](u v)` and `[text][r]` here\n'],
    ['a code block', '```\n[q]: a b\n[x](a b)\n```\n'],
  ])('leaves narrow-space link text in %s as it is', (_, tail) => {
    const input = `[t](u v) and [ok](u-v)\n\n[r]: https://e.com /path\n[text][r]\n\n${tail}`
    const result = upgrade(input)
    expect(result.check).toBe('pass')
    expect(render(result.output)).toBe(carveToHtml(input))
  })

  it.each([
    ['a code span', 'see `{{ x @code:js }}` here\n'],
    ['a code block', '```\n{{ x @code:js }}\n```\n'],
  ])('leaves include-shaped text in %s as it is', (_, tail) => {
    const input = `:: t\n{{ data/p2.csv  @code:csv @lines:00-2 }}\n\n${tail}`
    const result = upgrade(input)
    expect(result.check).toBe('pass')
    expect(render(result.output)).toBe(carveToHtml(input))
  })
})
