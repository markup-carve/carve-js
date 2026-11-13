// Pairs of contract entries that touch the same line or the same block: one input holds both, the
// output is what both rewrites give together, the self-check passes, and a second run is stable.
import { describe, expect, it } from 'vitest'
import { upgrade } from '../src/index.ts'

interface Pair {
  entries: string
  input: string
  output: string
}

const PAIRS: Pair[] = [
  { entries: 'U-001 U-065', input: 'Some text\n# A _b_ heading\n', output: 'Some text\n\n# A {_b_} heading\n' },
  { entries: 'U-065 U-066 U-067', input: 'a _u_ b ~s~ c =m= d\n', output: 'a {_u_} b {~s~} c {=m=} d\n' },
  { entries: 'U-065 U-066', input: 'a _u ~s~ v_ b\n', output: 'a {_u {~s~} v_} b\n' },
  { entries: 'U-065 U-068', input: '/*bold _u_ italic*/\n', output: '*/bold {_u_} italic/*\n' },
  { entries: 'U-002 U-016', input: 'Some text\n> quoted\n+\n- a list\n', output: 'Some text\n\n> quoted\n>\n> - a list\n' },
  { entries: 'U-014 U-065', input: '- step _one_\n+\n> a _note_\n- step two\n', output: '- step {_one_}\n\n  > a {_note_}\n- step two\n' },
  { entries: 'U-055 U-065 U-066', input: '| _a_ | b |\n|---|--:|\n| 1 | ~2~ |\n', output: '|= {_a_} |={>} b |\n| 1 | {~2~} |\n' },
  { entries: 'U-055 U-063', input: '| a | b |\n|---|---|\n| 1 | 2 |\n\n^ Caption\n', output: '|= a |= b |\n| 1 | 2 |\n^ Caption\n' },
  { entries: 'U-056 U-058', input: '{header-rows=1}\n| a | b |\n|=> 1 | 2 |\n', output: '|= a |= b |\n|={>} 1 | 2 |\n' },
  { entries: 'U-031 U-044', input: 'para\n\n{.x}\n\n---\n', output: 'para\n\n{.x}\n***\n' },
  { entries: 'U-003 U-032', input: 'Some text\n{.a\n .b}\nNext block\n', output: 'Some text\n\n{.a .b}\nNext block\n' },
  { entries: 'U-020 U-065', input: '{loose}\n- _a_\n- b\n', output: '- {_a_}\n\n- b\n' },
  { entries: 'U-015 U-018', input: '- a\n+\nsecond\n\n  third\n- b\n', output: '- a\n\n  second\n\n  third\n\n- b\n' },
  { entries: 'U-038 U-065', input: '> See [ref][].\n>\n> [ref]: https://example.com\n\nOutside _u_ [ref][].\n', output: '> See [ref][].\n\n[ref]: https://example.com\n\nOutside {_u_} [ref][].\n' },
  { entries: 'U-038 U-065', input: '- item[^n]\n\n  [^n]: A _note_ defined in the item.\n', output: '- item[^n]\n\n[^n]: A {_note_} defined in the item.\n' },
  { entries: 'U-067 U-101', input: '= 4 is =the= answer\n', output: '\\= 4 is {=the=} answer\n' },
  { entries: 'U-001 U-101', input: 'Some text\n# Heading\n= not a heading\n', output: 'Some text\n\n# Heading\n\\= not a heading\n' },
  { entries: 'U-065 U-103', input: 'a. _one_\nb. two\n', output: 'a\\. {_one_}\nb. two\n' },
  { entries: 'U-065 U-110', input: '# My Heading\n\nSee _u_ [the text][My Heading].\n', output: '# My Heading\n\nSee {_u_} \\[the text][My Heading].\n' },
  { entries: 'U-113', input: 'See [_b_ and /i/][nope].\n', output: 'See [\\_b\\_ and \\/i\\/][nope].\n' },
  { entries: 'U-069 U-070', input: '*bold {~a*~>b~} more*\n', output: '*bold {-a\\*-}{+b+} more*\n' },
  { entries: 'U-065 U-071', input: 'said \'Bob _and_ left.\n', output: 'said ’Bob {_and_} left.\n' },
  { entries: 'U-001 U-106', input: ':: term\nmore term text\n# Heading\n', output: ':: term\n\nmore term text\n\n# Heading\n' },
  { entries: 'U-063 U-107', input: '| a | b |\n\n^ first\n^ second\n', output: '| a | b |\n^ first\n\n^ second\n' },
  { entries: 'U-022 U-065', input: ' 9. _a_\n10. b\n', output: '9. {_a_}\n10. b\n' },
  { entries: 'U-024 U-065', input: 'i) _one_\nj) two\n', output: '{start=9}\na) {_one_}\nb) two\n' },
  { entries: 'U-026 U-050', input: '- a\n%%%\nx\n%%% y\n- b\n', output: '- a\n  %%%\n  x\n  y\n  %%%\n- b\n' },
  { entries: 'U-057 U-066', input: '| ~a~ | b \\|\n', output: '| {~a~} | b \\| |\n' },
  { entries: 'U-037', input: '```js {.x} My Title\ncode\n```\n', output: '```js\ncode\n```\n' },
  { entries: 'U-045', input: 'Some text\n- - -\n# H\n', output: 'Some text\n***\n# H\n' },
]

describe('entries that meet on one line', () => {
  for (const pair of PAIRS) {
    it(`${pair.entries}: ${JSON.stringify(pair.input)}`, () => {
      const result = upgrade(pair.input)
      expect(result.output).toBe(pair.output)
      expect(result.check).toBe('pass')
      const hit = [...new Set(result.records.map((record) => record.entry))].filter((entry) => entry.startsWith('U-')).sort()
      expect(hit.join(' ')).toBe(pair.entries)
      expect(result.records.some((record) => record.entry === 'upgrade-conflict')).toBe(false)
    })
  }

  it('a definition that leaves its container keeps the rewrites inside it', () => {
    // U-038 edits only the prefix of the definition's lines, so U-065 inside the note still applies.
    const result = upgrade('- item[^n]\n\n  [^n]: A _note_ defined in the item.\n')
    expect(result.output).toBe('- item[^n]\n\n[^n]: A {_note_} defined in the item.\n')
    expect(result.check).toBe('pass')
  })

  it('nothing inside a reference 0.1 left unresolved is respelled, only escaped (U-113 over U-065)', () => {
    const result = upgrade('See [_b_ and /i/][nope].\n')
    expect(result.output).toBe('See [\\_b\\_ and \\/i\\/][nope].\n')
    expect(result.check).toBe('pass')
  })
})
