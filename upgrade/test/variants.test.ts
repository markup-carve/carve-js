// Variants around the inputs of the contract: the same construct in a quote, in an item, in a
// description or a footnote body, on a marker line, and with other spellings. Each gives the
// output shown, the self-check finds no unexplained difference, and a second run is stable,
// except where the output is itself the input of U-018 (see contract.test.ts).
import { describe, expect, it } from 'vitest'
import { upgrade } from '../src/index.ts'

interface Variant {
  entries: string
  input: string
  output: string
  check: 'pass' | 'explained'
  stable: boolean
}

const VARIANTS: Variant[] = [
  { entries: 'U-001', input: '> Some text\n> # Heading\n', output: '> Some text\n>\n> # Heading\n', check: 'pass', stable: true },
  { entries: 'U-002', input: '> Some text\n> > quote\n', output: '> Some text\n>\n> > quote\n', check: 'pass', stable: true },
  { entries: 'U-002', input: '- Some text\n  > quote\n', output: '- Some text\n\n  > quote\n', check: 'pass', stable: true },
  { entries: 'U-003', input: '> Some text\n> {.x}\n> Next block\n', output: '> Some text\n>\n> {.x}\n> Next block\n', check: 'pass', stable: true },
  { entries: 'U-004', input: '> Some text\n> :: term\n> : description\n', output: '> Some text\n>\n> :: term\n> : description\n', check: 'pass', stable: true },
  { entries: 'U-006', input: '- a\n  - b\n  # H\n', output: '- a\n  - b\n\n  # H\n', check: 'pass', stable: true },
  { entries: 'U-018', input: '- a\n\n  second\n- b\n- c\n', output: '- a\n\n  second\n\n- b\n- c\n', check: 'pass', stable: true },
  { entries: 'U-018', input: '> - a\n>\n>   second\n> - b\n', output: '> - a\n>\n>   second\n>\n> - b\n', check: 'pass', stable: true },
  { entries: 'U-018', input: '1. a\n\n   second\n2. b\n', output: '1. a\n\n   second\n\n2. b\n', check: 'pass', stable: true },
  { entries: 'U-014', input: '- step one\n+\n```\ncode\n```\n- step two\n', output: '- step one\n\n  ```\n  code\n  ```\n- step two\n', check: 'pass', stable: false },
  { entries: 'U-014', input: '- step one\n+\n| a | b |\n- step two\n', output: '- step one\n\n  | a | b |\n- step two\n', check: 'pass', stable: false },
  { entries: 'U-014', input: '- a\n  - b\n  +\n  > q\n- c\n', output: '- a\n  - b\n\n    > q\n- c\n', check: 'pass', stable: true },
  { entries: 'U-014', input: ':: term\n: desc\n+\n> q\n', output: ':: term\n: desc\n\n  > q\n', check: 'pass', stable: true },
  { entries: 'U-014', input: 'Text[^n].\n\n[^n]: note\n+\n> q\n', output: 'Text[^n].\n\n[^n]: note\n\n      > q\n', check: 'pass', stable: true },
  { entries: 'U-014', input: '> - a\n> +\n> > q\n', output: '> - a\n>\n>   > q\n', check: 'pass', stable: true },
  { entries: 'U-031', input: '{.x}\n\n\n# Heading\n', output: '{.x}\n# Heading\n', check: 'pass', stable: true },
  { entries: 'U-031', input: '> {.note}\n>\n> Paragraph.\n', output: '> {.note}\n> Paragraph.\n', check: 'pass', stable: true },
  { entries: 'U-032', input: '{#i .a\n key=v}\n- a\n', output: '{#i .a key=v}\n- a\n', check: 'pass', stable: true },
  { entries: 'U-034', input: 'Paragraph.\n\n{.x}\n\n', output: 'Paragraph.\n', check: 'pass', stable: true },
  { entries: 'U-055', input: '> | a | b |\n> |---|:-:|\n> | 1 | 2 |\n', output: '> |= a |={~} b |\n> | 1 | 2 |\n', check: 'pass', stable: true },
  { entries: 'U-055', input: '- | a | b |\n  |:--|---|\n  | 1 | 2 |\n', output: '- |={<} a |= b |\n  | 1 | 2 |\n', check: 'pass', stable: true },
  { entries: 'U-055', input: '|a|b|\n|-|-|\n|1|2|\n', output: '|= a|= b|\n|1|2|\n', check: 'pass', stable: true },
  { entries: 'U-036 U-058', input: '{header-rows=2 .t}\n| a | b |\n| c | d |\n| 1 | 2 |\n', output: '{.t}\n|= a |= b |\n|= c |= d |\n| 1 | 2 |\n', check: 'pass', stable: true },
  { entries: 'U-044', input: '> para\n>\n> ---\n>\n> next\n', output: '> para\n>\n> ***\n>\n> next\n', check: 'pass', stable: true },
  { entries: 'U-018 U-044', input: '- a\n\n  ___\n- b\n', output: '- a\n\n  ***\n\n- b\n', check: 'pass', stable: true },
  { entries: 'U-065 U-066', input: 'x *bold _u_ and ~s~* y\n', output: 'x *bold {_u_} and {~s~}* y\n', check: 'pass', stable: true },
  { entries: 'U-065', input: '[_u_ link](/u) and ^[a _note_ here]\n', output: '[{_u_} link](/u) and ^[a {_note_} here]\n', check: 'pass', stable: true },
  { entries: 'U-065 U-067', input: '| =m= | _u_ |\n', output: '| {=m=} | {_u_} |\n', check: 'pass', stable: true },
  { entries: 'U-065 U-066', input: '# A _b_ ~c~\n', output: '# A {_b_} {~c~}\n', check: 'pass', stable: true },
  { entries: 'U-101', input: '- [ ] = x\n', output: '- [ ] \\= x\n', check: 'pass', stable: true },
  { entries: 'U-101', input: ':: = x\n: = y\n', output: ':: = x\n: \\= y\n', check: 'pass', stable: true },
  { entries: 'U-103', input: '> a. one\n> b. two\n', output: '> a\\. one\n> b. two\n', check: 'pass', stable: true },
  { entries: 'U-103', input: '- a. one\n  b. two\n', output: '- a\\. one\n  b\\. two\n', check: 'pass', stable: true },
  { entries: 'U-103', input: 'A) one\n\nI. two\n\niv. three\n', output: 'A) one\n\nI. two\n\niv\\. three\n', check: 'pass', stable: true },
  { entries: 'U-001 U-019 U-102', input: '# H\n\n- a\n  # Inner\n    more\n', output: '# H\n\n- a\n\n  # Inner\n  more\n', check: 'pass', stable: true },
  { entries: 'U-102', input: '## Heading\n   text\n   more\n', output: '## Heading\ntext\n   more\n', check: 'pass', stable: true },
  { entries: 'U-038', input: '> Text [a][].\n>\n>  [a]: /u\n', output: '> Text [a][].\n\n[a]: /u\n', check: 'pass', stable: true },
  { entries: 'U-021 U-038', input: '- a\n\n  [r]: /u\n\n  tail [x][r]\n', output: '- a\n\n\n  tail [x][r]\n\n[r]: /u\n', check: 'explained', stable: true },
  { entries: 'U-041', input: '*[A]: one\n*[B]: x\n*[A]: two\n\nA B\n', output: '*[B]: x\n*[A]: two\n\nA B\n', check: 'pass', stable: true },
  { entries: 'U-040', input: '[a]: /one\n\ntext\n\n[a]: /two\n\n[x][a]\n', output: '\ntext\n\n[a]: /two\n\n[x][a]\n', check: 'pass', stable: true },
  { entries: 'U-049', input: '~~~\ncode\n  ~~~\nafter\n', output: '~~~~\ncode\n  ~~~\nafter\n~~~~\n', check: 'pass', stable: true },
  { entries: 'U-049', input: '- ```\n  code\n    ```\n  after\n- b\n', output: '- ````\n  code\n    ```\n  after\n  ````\n- b\n', check: 'pass', stable: true },
  { entries: 'U-050', input: '> %%%\n> hidden\n> %%% visible\n> after\n', output: '> %%%\n> hidden\n> visible\n> %%%\n> after\n', check: 'pass', stable: true },
  { entries: 'U-051', input: '```js title\ncode\n```\n', output: '```js\ncode\n```\n', check: 'pass', stable: true },
  { entries: 'U-051', input: '::: warning Be careful\nbody\n:::\n', output: '::: warning\nbody\n:::\n', check: 'pass', stable: true },
  { entries: 'U-071', input: '\'Twas \'quoted\' and \'open\n', output: '\'Twas \'quoted\' and ’open\n', check: 'pass', stable: true },
  { entries: 'U-112', input: 'See [x][^n] and [y][^m].\n\n[^n]: N.\n', output: 'See [x]\\[^n] and [y]\\[^m].\n\n[^n]: N.\n', check: 'pass', stable: true },
  { entries: 'U-110', input: '# T\n\n[a][T] and [T][] and [b][T]\n', output: '# T\n\n\\[a][T] and [T][] and \\[b][T]\n', check: 'pass', stable: true },
  { entries: '', input: '| a | b |\n\n\n^ Caption\n', output: '| a | b |\n\n\n^ Caption\n', check: 'pass', stable: true },
  { entries: 'U-063', input: '![alt](i.png)\n\n^ Caption\n', output: '![alt](i.png)\n^ Caption\n', check: 'pass', stable: true },
  { entries: 'U-063', input: '```\nx\n```\n\n^ Listing\n', output: '```\nx\n```\n^ Listing\n', check: 'pass', stable: true },
  // A `+` that attaches nothing, an empty first block, a cell that starts with a bare span, and
  // a block indented short of the content column above: beyond the inputs of the contract.
  { entries: 'U-014', input: '- a\n+\n- b\n', output: '- a\n- b\n', check: 'pass', stable: true },
  { entries: 'U-014', input: '> q\n+\n\npara\n', output: '> q\n\npara\n', check: 'pass', stable: true },
  { entries: 'U-017', input: '- +\n- b\n', output: '- {%%}\n- b\n', check: 'pass', stable: true },
  { entries: 'U-017', input: '- +\nx\n- b\n', output: '- x\n- b\n', check: 'pass', stable: true },
  { entries: 'U-017', input: '1. +\n   > q\n', output: '1. > q\n', check: 'pass', stable: true },
  { entries: 'U-065 U-067', input: '|=hot= | _u_|\n', output: '| {=hot=} | {_u_}|\n', check: 'pass', stable: true },
  { entries: 'U-006 U-109', input: '- one\n > q\n', output: '- one\n\n> q\n', check: 'pass', stable: true },
  { entries: 'U-109', input: '- one\n\n > q\n > r\n', output: '- one\n\n> q\n> r\n', check: 'pass', stable: true },
  { entries: 'U-021', input: '- one\n\n  # H\n', output: '- one\n\n  # H\n', check: 'explained', stable: true },
  { entries: '', input: 'Text[^a].\n\n[^a]: first\n\n  > quote two spaces\n', output: 'Text[^a].\n\n[^a]: first\n\n  > quote two spaces\n', check: 'pass', stable: true },
  { entries: 'U-014', input: '- a\n+\n\npara\n', output: '- a\n\npara\n', check: 'pass', stable: true },
  // A first-block `+` in a quote, and a container the `+` left empty.
  { entries: 'U-017', input: '> +\n', output: '>\n', check: 'pass', stable: true },
  { entries: 'U-017', input: '> +\nq\n', output: '> q\n', check: 'pass', stable: true },
  { entries: 'U-017', input: '> +\n flush\n', output: '>\n\n flush\n', check: 'pass', stable: true },
  { entries: 'U-017 U-109', input: '- +\n flush\n', output: '- {%%}\n\nflush\n', check: 'pass', stable: true },
  { entries: 'U-017', input: '- +\n- b\n', output: '- {%%}\n- b\n', check: 'pass', stable: true },
  { entries: 'U-017', input: '* * +\nx\n', output: '* * {%%}\n\nx\n', check: 'pass', stable: true },
  { entries: 'U-017', input: '> > +\n> b\n', output: '> > b\n', check: 'pass', stable: true },
  { entries: 'U-017', input: '- +\n{x}\n- c\n', output: '- {%%}\n\n{x}\n- c\n', check: 'pass', stable: true },
  { entries: 'U-017', input: '> +\n\nafter\n', output: '>\n\nafter\n', check: 'pass', stable: true },
  { entries: 'U-017', input: '- a\n  - +\npara\n', output: '- a\n  - {%%}\n\npara\n', check: 'pass', stable: true },
  // A definition in the middle of a block: 0.1 reads a paragraph on across it and keeps a list whole.
  { entries: 'U-038', input: '- a\n  [r]: /u\n more\ntail\n\n[x][r]\n', output: '- a\n more\ntail\n\n[r]: /u\n\n[x][r]\n', check: 'pass', stable: true },
  { entries: 'U-005', input: 'Some text\n[r]: /u\nmore text [x][r]\n', output: 'Some text\nmore text [x][r]\n\n[r]: /u\n', check: 'pass', stable: true },
  { entries: 'U-005', input: '- a\n[r]: /u\n- b [x][r]\n', output: '- a\n- b [x][r]\n\n[r]: /u\n', check: 'pass', stable: true },
  { entries: 'U-038', input: '- a\n  *[A]: x\ntail A\n', output: '- a\ntail A\n\n*[A]: x\n', check: 'pass', stable: true },
  { entries: 'U-038', input: ':: t\n:  d\n [r]: /u\ntail [r][]\n', output: ':: t\n:  d\ntail [r][]\n\n[r]: /u\n', check: 'pass', stable: true },
  { entries: 'U-005', input: 'Text[^n]\n[^n]: note\nmore\n', output: 'Text[^n]\n\n[^n]: note\nmore\n', check: 'pass', stable: true },
]

describe('variants of the contract inputs', () => {
  for (const variant of VARIANTS) {
    it(`${variant.entries === '' ? 'nothing' : variant.entries}: ${JSON.stringify(variant.input)}`, () => {
      const result = upgrade(variant.input)
      expect(result.output).toBe(variant.output)
      expect(result.check).toBe(variant.check)
      const hit = [...new Set(result.records.map((record) => record.entry))].filter((entry) => entry.startsWith('U-')).sort()
      expect(hit.join(' ')).toBe(variant.entries)
      expect(upgrade(result.output).output === result.output).toBe(variant.stable)
    })
  }

  it('takes a bidirectional control out of text and code, as 0.1 did in its output (X-001)', () => {
    const result = upgrade('a\u202eb `c\u2066d`\n')
    expect([result.output, result.check]).toEqual(['ab `cd`\n', 'pass'])
    expect(result.records.map((record) => [record.entry, record.class, record.lint])).toEqual([
      ['X-001', 'rewrite', 'bidi-control-in-source'], ['X-001', 'rewrite', 'bidi-control-in-source'],
    ])
  })

  it('leaves a bidirectional control in a destination, where it changes what the value tests as', () => {
    const input = '[x](\u202ejavascript:alert(1))\n'
    expect(upgrade(input).output).toBe(input)
  })

  it('writes U+0000 as U+FFFD, as 0.1 rendered it (X-002)', () => {
    const result = upgrade('a\u0000b\n')
    expect([result.output, result.check]).toEqual(['a\ufffdb\n', 'pass'])
  })

  it('an earlier definition of a key is removed in a quote too (U-040)', () => {
    const result = upgrade('> a\n>\n> [r]: /one\n\n> b\n>\n> [r]: /two\n\n[x][r]\n')
    expect(result.output).toBe('> a\n>\n\n> b\n\n[r]: /two\n\n[x][r]\n')
    expect(result.records.map((record) => record.entry)).toContain('U-040')
    expect(result.check).toBe('pass')
  })
})
